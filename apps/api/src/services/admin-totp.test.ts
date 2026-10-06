import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
    config: { encryptionKey: 'k'.repeat(64), adminJwtSecret: 'admin-secret-for-tests-0123456789abcdef', jwtSecret: 'x' },
}));

import {
    base32Encode,
    base32Decode,
    totpAt,
    verifyTotp,
    generateTotpSecret,
    buildOtpauthUri,
    generateRecoveryCodes,
    hashRecoveryCode,
    beginEnrolment,
    confirmEnrolment,
    checkLoginCode,
    disableTotp,
    isTwoFactorRequired,
    resetTotpGuards,
} from './admin-totp.js';
import { encrypt } from './crypto.js';
import { clearSwitchCache } from './platform-switches.js';

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
    it('round-trips arbitrary bytes and matches the RFC 4648 vector', () => {
        expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
        expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
        const bytes = Buffer.from([0, 255, 17, 3, 99, 200, 1]);
        expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    });
    it('decodes lower-case and spaced input, rejects garbage', () => {
        expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
        expect(() => base32Decode('not*base32!')).toThrow();
    });
});

describe('TOTP (RFC 6238)', () => {
    it.each([
        [59, '287082'],
        [1111111109, '081804'],
        [1111111111, '050471'],
        [1234567890, '005924'],
        [2000000000, '279037'],
        [20000000000, '353130'],
    ])('code at unix %i is %s (6 digits of the RFC vector)', (t, code) => {
        expect(totpAt(RFC_SECRET, t * 1000)).toBe(code);
    });

    it('accepts the current code and one step either side, rejects two steps away', () => {
        const now = 1_700_000_000_000;
        const at = (offsetSteps: number) => totpAt(RFC_SECRET, now + offsetSteps * 30_000);
        expect(verifyTotp(RFC_SECRET, at(0), now)).not.toBeNull();
        expect(verifyTotp(RFC_SECRET, at(-1), now)).not.toBeNull();
        expect(verifyTotp(RFC_SECRET, at(1), now)).not.toBeNull();
        expect(verifyTotp(RFC_SECRET, at(-2), now)).toBeNull();
        expect(verifyTotp(RFC_SECRET, at(2), now)).toBeNull();
    });

    it('returns the matched time step so a replay can be refused', () => {
        const now = 1_700_000_000_000;
        expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now)).toBe(Math.floor(now / 30_000));
    });

    it('rejects malformed codes without throwing', () => {
        for (const bad of ['', '12345', '1234567', 'abcdef', '12 345', null, undefined, 123456 as any]) {
            expect(verifyTotp(RFC_SECRET, bad as any, 1_700_000_000_000)).toBeNull();
        }
    });
});

describe('secret + otpauth URI', () => {
    it('generates a 160-bit base32 secret, different each time', () => {
        const a = generateTotpSecret();
        expect(a).toMatch(/^[A-Z2-7]{32}$/);
        expect(generateTotpSecret()).not.toBe(a);
    });
    it('builds an otpauth URI with escaped label and issuer', () => {
        const uri = buildOtpauthUri({ secret: 'ABC234', accountName: 'a b@x.com', issuer: 'Bookly Admin' });
        expect(uri).toBe('otpauth://totp/Bookly%20Admin:a%20b%40x.com?secret=ABC234&issuer=Bookly%20Admin&algorithm=SHA1&digits=6&period=30');
    });
});

describe('recovery codes', () => {
    it('generates 10 distinct, human-typeable codes', () => {
        const codes = generateRecoveryCodes();
        expect(codes).toHaveLength(10);
        expect(new Set(codes).size).toBe(10);
        for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    });
    it('hashes case/dash-insensitively and never stores plaintext', () => {
        const h = hashRecoveryCode('ab23c-de45f');
        expect(h).toBe(hashRecoveryCode('AB23CDE45F'));
        expect(h).not.toContain('ab23c');
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
});

function adminStub(row: any) {
    const state = { row: { ...row } };
    const prisma: any = {
        state,
        admin: {
            findUnique: vi.fn(async () => state.row),
            update: vi.fn(async ({ data }: any) => { state.row = { ...state.row, ...data }; return state.row; }),
        },
        platformSetting: { findUnique: vi.fn(async () => null) },
        $executeRaw: vi.fn(async () => 1),
    };
    return prisma;
}

describe('enrolment', () => {
    beforeEach(() => resetTotpGuards());

    it('begin stores the secret ENCRYPTED, leaves 2FA disabled, returns the secret once', async () => {
        const prisma = adminStub({ id: 'a1', email: 'a@x.com', totpSecretEnc: null, totpEnabledAt: null });
        const out = await beginEnrolment(prisma, { id: 'a1', email: 'a@x.com' });
        expect(out.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(out.otpauthUri).toContain(`secret=${out.secret}`);
        const data = prisma.admin.update.mock.calls[0][0].data;
        expect(data.totpSecretEnc).toBeTruthy();
        expect(data.totpSecretEnc).not.toContain(out.secret);
        expect(data.totpEnabledAt).toBeNull();
    });

    it('refuses to re-enrol while 2FA is enabled', async () => {
        const prisma = adminStub({ id: 'a1', email: 'a@x.com', totpSecretEnc: encrypt('X'), totpEnabledAt: new Date() });
        await expect(beginEnrolment(prisma, { id: 'a1', email: 'a@x.com' })).rejects.toThrow(/already enabled/i);
    });

    it('confirm with a wrong code enables nothing; with the right code enables and returns recovery codes once', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({ id: 'a1', email: 'a@x.com', totpSecretEnc: encrypt(secret), totpEnabledAt: null });
        const now = 1_700_000_000_000;
        expect(await confirmEnrolment(prisma, 'a1', '000000', now)).toEqual({ ok: false, reason: 'invalid_code' });
        expect(prisma.admin.update).not.toHaveBeenCalled();

        const ok = await confirmEnrolment(prisma, 'a1', totpAt(secret, now), now);
        expect(ok.ok).toBe(true);
        if (!ok.ok) return;
        expect(ok.recoveryCodes).toHaveLength(10);
        const data = prisma.admin.update.mock.calls[0][0].data;
        expect(data.totpEnabledAt).toBeInstanceOf(Date);
        expect(data.recoveryCodeHashes).toEqual(ok.recoveryCodes.map(hashRecoveryCode));
        expect(JSON.stringify(data)).not.toContain(ok.recoveryCodes[0]);
    });

    it('confirm without a pending enrolment fails', async () => {
        const prisma = adminStub({ id: 'a1', totpSecretEnc: null, totpEnabledAt: null });
        expect(await confirmEnrolment(prisma, 'a1', '123456')).toEqual({ ok: false, reason: 'not_enrolling' });
    });
});

describe('checkLoginCode', () => {
    beforeEach(() => resetTotpGuards());
    const now = 1_700_000_000_000;
    const enabled = (secret: string, hashes: string[] = []) => ({
        id: 'a1', totpSecretEnc: encrypt(secret), totpEnabledAt: new Date(), recoveryCodeHashes: hashes,
    });

    it('accepts a valid TOTP once and refuses the same code again (replay)', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({});
        const code = totpAt(secret, now);
        expect(await checkLoginCode(prisma, enabled(secret), code, now)).toEqual({ ok: true, method: 'totp' });
        expect(await checkLoginCode(prisma, enabled(secret), code, now)).toEqual({ ok: false, reason: 'invalid_code' });
    });

    it('accepts a recovery code exactly once (atomic consume)', async () => {
        const secret = generateTotpSecret();
        const [rc] = generateRecoveryCodes(1);
        const prisma = adminStub({});
        prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        const admin = enabled(secret, [hashRecoveryCode(rc)]);
        expect(await checkLoginCode(prisma, admin, rc, now)).toEqual({ ok: true, method: 'recovery' });
        expect(await checkLoginCode(prisma, admin, rc, now)).toEqual({ ok: false, reason: 'invalid_code' });
    });

    it('does not consume anything for a recovery code that is not on file', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({});
        const out = await checkLoginCode(prisma, enabled(secret, [hashRecoveryCode('aaaaa-bbbbb')]), 'ccccc-ddddd', now);
        expect(out).toEqual({ ok: false, reason: 'invalid_code' });
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('locks the admin out after 5 wrong codes, even for a correct one', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({});
        for (let i = 0; i < 5; i++) {
            expect(await checkLoginCode(prisma, enabled(secret), '000000', now)).toEqual({ ok: false, reason: 'invalid_code' });
        }
        expect(await checkLoginCode(prisma, enabled(secret), totpAt(secret, now), now)).toEqual({ ok: false, reason: 'locked' });
        // lock expires
        expect((await checkLoginCode(prisma, enabled(secret), totpAt(secret, now + 16 * 60_000), now + 16 * 60_000)).ok).toBe(true);
    });

    it('a half-finished enrolment does not require or accept a code', async () => {
        const prisma = adminStub({});
        const out = await checkLoginCode(prisma, { id: 'a1', totpSecretEnc: encrypt('X'), totpEnabledAt: null, recoveryCodeHashes: [] }, '123456', now);
        expect(out).toEqual({ ok: false, reason: 'not_enabled' });
    });
});

describe('disable + platform requirement', () => {
    it('disable clears secret, timestamp and recovery codes', async () => {
        const prisma = adminStub({ id: 'a1' });
        await disableTotp(prisma, 'a1');
        expect(prisma.admin.update.mock.calls[0][0].data).toEqual({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [] });
    });
    it('isTwoFactorRequired reads the PlatformSetting and defaults to false', async () => {
        const prisma = adminStub({});
        expect(await isTwoFactorRequired(prisma)).toBe(false);
        prisma.platformSetting.findUnique.mockResolvedValue({ key: 'admin.require2fa', value: { enabled: true } });
        clearSwitchCache();
        expect(await isTwoFactorRequired(prisma)).toBe(true);
    });
});

describe('guards hold across API instances when Redis is shared', () => {
    const now = 1_700_000_000_000;
    const enabled = (secret: string) => ({ id: 'a1', totpSecretEnc: encrypt(secret), totpEnabledAt: new Date(), recoveryCodeHashes: [] as string[] });
    function sharedRedis() {
        const m = new Map<string, string>();
        return {
            get: async (k: string) => m.get(k) ?? null,
            set: async (k: string, v: string, ...a: any[]) => { if (a.includes('NX') && m.has(k)) return null; m.set(k, v); return 'OK'; },
            incr: async (k: string) => { const n = Number(m.get(k) ?? 0) + 1; m.set(k, String(n)); return n; },
            expire: async () => 1,
            del: async (...ks: string[]) => { ks.forEach((k) => m.delete(k)); return ks.length; },
        } as any;
    }

    it('a lock set by one instance is seen by another (memory wiped between calls)', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({});
        const redis = sharedRedis();
        for (let i = 0; i < 5; i++) {
            resetTotpGuards(); // a different process each time
            await checkLoginCode(prisma, enabled(secret), '000000', now, redis);
        }
        resetTotpGuards();
        expect(await checkLoginCode(prisma, enabled(secret), totpAt(secret, now), now, redis)).toEqual({ ok: false, reason: 'locked' });
    });

    it('a TOTP step used on one instance is refused on another', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({});
        const redis = sharedRedis();
        const code = totpAt(secret, now);
        expect((await checkLoginCode(prisma, enabled(secret), code, now, redis)).ok).toBe(true);
        resetTotpGuards();
        expect(await checkLoginCode(prisma, enabled(secret), code, now, redis)).toEqual({ ok: false, reason: 'invalid_code' });
    });

    it('two concurrent logins with the same code: exactly one wins', async () => {
        const secret = generateTotpSecret();
        const prisma = adminStub({});
        const redis = sharedRedis();
        const code = totpAt(secret, now);
        const results = await Promise.all([
            checkLoginCode(prisma, enabled(secret), code, now, redis),
            checkLoginCode(prisma, enabled(secret), code, now, redis),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
    });
});
