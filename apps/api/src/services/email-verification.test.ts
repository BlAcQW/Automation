import { describe, expect, it } from 'vitest';
import { VERIFY_TOKEN_TTL_SECONDS, createVerifyToken, verifyEmailToken, verificationEmail } from './email-verification.js';

const SECRET = 'test-secret';
const user = { id: 'u1', email: 'Ama@Example.com' };

describe('email verification tokens', () => {
    it('round-trips and lower-cases the address', () => {
        const t = createVerifyToken(user, SECRET);
        expect(verifyEmailToken(t, SECRET)).toEqual({ userId: 'u1', email: 'ama@example.com' });
    });

    it('expires after 7 days and rejects other secrets or tampering', () => {
        const issued = Date.now();
        const t = createVerifyToken(user, SECRET, issued);
        expect(verifyEmailToken(t, SECRET, issued + (VERIFY_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
        expect(verifyEmailToken(t, 'other', issued)).toBeNull();
        const [, sig] = t.split('.');
        const forged = Buffer.from(JSON.stringify({ sub: 'u2', email: 'x@y.z', exp: 4102444800 })).toString('base64url');
        expect(verifyEmailToken(`${forged}.${sig}`, SECRET)).toBeNull();
        expect(verifyEmailToken('garbage', SECRET)).toBeNull();
    });

    it('email carries the link and escapes names', () => {
        const m = verificationEmail({ name: '<b>Ama</b>', businessName: "Ama's Hair", link: 'https://x.test/v?token=abc' });
        expect(m.text).toContain('https://x.test/v?token=abc');
        expect(m.html).not.toContain('<b>Ama</b>');
        expect(m.html).toContain('Ama&#39;s Hair');
    });
});
