/**
 * Admin two-factor login: TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s) built on
 * node:crypto, plus single-use recovery codes.
 *
 * - The TOTP secret is shown ONCE (as an otpauth URI) at enrolment and stored
 *   encrypted (crypto.ts). 2FA only counts as enabled once the first code has
 *   verified (totpEnabledAt), so an abandoned enrolment cannot lock anyone out.
 * - Recovery codes are random, stored only as keyed hashes, and consumed with
 *   one atomic UPDATE so two concurrent logins cannot both use the same code.
 * - Wrong codes are throttled per admin (5 failures -> 15 min lock) and a TOTP
 *   time step can be used once. Both guards live in Redis when the caller passes
 *   one (so they hold across API instances) and in process memory otherwise
 *   (local dev; see admin-throttle.ts).
 */
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { decrypt, encrypt } from './crypto.js';
import { getPlatformSetting, REQUIRE_2FA_KEY } from './platform-switches.js';
import {
    claimOnce,
    clearFailures,
    getValue,
    isLocked,
    recordFailure,
    resetThrottleMemory,
    setValue,
    type ThrottleRedis,
} from './admin-throttle.js';
import type { AnyPrismaClient } from './usage.js';

const STEP_MS = 30_000;
const DIGITS = 6;
const WINDOW_STEPS = 1;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
/** Longer than the widest time the accepted window can reach back. */
const STEP_RECORD_TTL_SECONDS = 300;
const RECOVERY_CODE_COUNT = 10;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// No 0/1/o/l/i: recovery codes get read off paper.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const TOTP_ISSUER = 'Bookly Admin';

// ---------------------------------------------------------------
// base32 (RFC 4648, no padding on output)
// ---------------------------------------------------------------

export function base32Encode(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += B32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}

export function base32Decode(input: string): Buffer {
    const clean = input.replace(/[\s=]/g, '').toUpperCase();
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
        const idx = B32.indexOf(ch);
        if (idx < 0) throw new Error('Invalid base32 input');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

// ---------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------

function hotp(key: Buffer, counter: number): string {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', key).update(msg).digest();
    const offset = h[h.length - 1] & 0x0f;
    const bin =
        ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
    return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpAt(secretBase32: string, atMs: number): string {
    return hotp(base32Decode(secretBase32), Math.floor(atMs / STEP_MS));
}

function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The matched time step (for replay protection), or null. Never throws on bad input. */
export function verifyTotp(secretBase32: string, code: unknown, nowMs: number = Date.now()): number | null {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
    const key = base32Decode(secretBase32);
    const current = Math.floor(nowMs / STEP_MS);
    let matched: number | null = null;
    // Check every step in the window (no early exit) so timing does not reveal which matched.
    for (let step = current - WINDOW_STEPS; step <= current + WINDOW_STEPS; step++) {
        if (safeEqual(hotp(key, step), code) && matched === null) matched = step;
    }
    return matched;
}

export function generateTotpSecret(): string {
    return base32Encode(crypto.randomBytes(20));
}

export function buildOtpauthUri(args: { secret: string; accountName: string; issuer?: string }): string {
    const issuer = args.issuer ?? TOTP_ISSUER;
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(args.accountName)}`;
    return `otpauth://totp/${label}?secret=${args.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=30`;
}

// ---------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------

function randomChars(n: number): string {
    let s = '';
    // Rejection sampling: no modulo bias.
    const limit = 256 - (256 % RECOVERY_ALPHABET.length);
    while (s.length < n) {
        for (const b of crypto.randomBytes(n * 2)) {
            if (b < limit && s.length < n) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
        }
    }
    return s;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
    const codes = new Set<string>();
    while (codes.size < count) codes.add(`${randomChars(5)}-${randomChars(5)}`);
    return [...codes];
}

export function normaliseRecoveryCode(code: string): string {
    return code.replace(/[\s-]/g, '').toLowerCase();
}

/** Keyed hash: a leaked table alone cannot be brute-forced offline. */
export function hashRecoveryCode(code: string): string {
    return crypto.createHmac('sha256', config.adminJwtSecret).update(normaliseRecoveryCode(code)).digest('hex');
}

function looksLikeRecoveryCode(code: string): boolean {
    return /^[a-z2-9]{10}$/.test(normaliseRecoveryCode(code));
}

// ---------------------------------------------------------------
// Guards (Redis when available, else in-memory; see admin-throttle.ts)
// ---------------------------------------------------------------

const FAILURE_POLICY = { max: MAX_FAILURES, lockMs: LOCK_MS };
const failureKey = (adminId: string) => `totp:${adminId}`;

export function resetTotpGuards(): void {
    resetThrottleMemory();
}

/**
 * Has this TOTP step (or a later one) been used already? If not, record it.
 * Returns true when the step is fresh. The claim is atomic per step, so two
 * concurrent logins with the same code cannot both succeed.
 */
async function consumeStep(redis: ThrottleRedis | null | undefined, adminId: string, step: number, now: number): Promise<boolean> {
    const last = Number(await getValue(redis, `totp:step:${adminId}`, now));
    if (Number.isFinite(last) && last > 0 && step <= last) return false;
    if (!(await claimOnce(redis, `totp:used:${adminId}:${step}`, STEP_RECORD_TTL_SECONDS, now))) return false;
    await setValue(redis, `totp:step:${adminId}`, String(step), STEP_RECORD_TTL_SECONDS, now);
    return true;
}

// ---------------------------------------------------------------
// Enrolment / login / disable
// ---------------------------------------------------------------

export interface TotpAdminRow {
    id: string;
    totpSecretEnc: string | null;
    totpEnabledAt: Date | null;
    recoveryCodeHashes: string[];
}

export async function beginEnrolment(
    prisma: AnyPrismaClient,
    admin: { id: string; email: string },
): Promise<{ secret: string; otpauthUri: string }> {
    const row = await prisma.admin.findUnique({
        where: { id: admin.id },
        select: { totpEnabledAt: true },
    });
    if (row?.totpEnabledAt) throw new Error('Two-factor is already enabled; disable it first');
    const secret = generateTotpSecret();
    await prisma.admin.update({
        where: { id: admin.id },
        data: { totpSecretEnc: encrypt(secret), totpEnabledAt: null, recoveryCodeHashes: [] },
    });
    return { secret, otpauthUri: buildOtpauthUri({ secret, accountName: admin.email }) };
}

export type ConfirmResult =
    | { ok: true; recoveryCodes: string[] }
    | { ok: false; reason: 'not_enrolling' | 'invalid_code' | 'locked' };

export async function confirmEnrolment(
    prisma: AnyPrismaClient,
    adminId: string,
    code: string,
    now: number = Date.now(),
    redis?: ThrottleRedis | null,
): Promise<ConfirmResult> {
    const row = await prisma.admin.findUnique({
        where: { id: adminId },
        select: { totpSecretEnc: true, totpEnabledAt: true },
    });
    if (!row?.totpSecretEnc || row.totpEnabledAt) return { ok: false, reason: 'not_enrolling' };
    if (await isLocked(redis, failureKey(adminId), now)) return { ok: false, reason: 'locked' };
    const step = verifyTotp(decrypt(row.totpSecretEnc), code, now);
    if (step === null) {
        await recordFailure(redis, failureKey(adminId), FAILURE_POLICY, now);
        return { ok: false, reason: 'invalid_code' };
    }
    await setValue(redis, `totp:step:${adminId}`, String(step), STEP_RECORD_TTL_SECONDS, now);
    await clearFailures(redis, failureKey(adminId));
    const recoveryCodes = generateRecoveryCodes();
    await prisma.admin.update({
        where: { id: adminId },
        data: { totpEnabledAt: new Date(now), recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) },
    });
    return { ok: true, recoveryCodes };
}

export type LoginCodeResult =
    | { ok: true; method: 'totp' | 'recovery' }
    | { ok: false; reason: 'invalid_code' | 'locked' | 'not_enabled' };

export async function checkLoginCode(
    prisma: AnyPrismaClient,
    admin: TotpAdminRow,
    code: unknown,
    now: number = Date.now(),
    redis?: ThrottleRedis | null,
): Promise<LoginCodeResult> {
    if (!admin.totpSecretEnc || !admin.totpEnabledAt) return { ok: false, reason: 'not_enabled' };
    if (await isLocked(redis, failureKey(admin.id), now)) return { ok: false, reason: 'locked' };
    const fail = async (): Promise<LoginCodeResult> => {
        await recordFailure(redis, failureKey(admin.id), FAILURE_POLICY, now);
        return { ok: false, reason: 'invalid_code' };
    };
    if (typeof code !== 'string') return fail();
    const trimmed = code.trim();

    if (/^\d{6}$/.test(trimmed)) {
        const step = verifyTotp(decrypt(admin.totpSecretEnc), trimmed, now);
        if (step === null) return fail();
        if (!(await consumeStep(redis, admin.id, step, now))) return fail(); // replay
        await clearFailures(redis, failureKey(admin.id));
        return { ok: true, method: 'totp' };
    }

    if (looksLikeRecoveryCode(trimmed)) {
        const hash = hashRecoveryCode(trimmed);
        if (!admin.recoveryCodeHashes.includes(hash)) return fail();
        // One statement removes the code only if it is still there: of two
        // concurrent logins with the same code, exactly one sees count 1.
        const consumed = await prisma.$executeRaw`
            UPDATE "Admin"
            SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${hash})
            WHERE "id" = ${admin.id} AND ${hash} = ANY("recoveryCodeHashes")`;
        if (consumed !== 1) return fail();
        await clearFailures(redis, failureKey(admin.id));
        return { ok: true, method: 'recovery' };
    }
    return fail();
}

export async function disableTotp(
    prisma: AnyPrismaClient,
    adminId: string,
    redis?: ThrottleRedis | null,
): Promise<void> {
    await prisma.admin.update({
        where: { id: adminId },
        data: { totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [] },
    });
    await clearFailures(redis, failureKey(adminId));
}

/** Replace all recovery codes (caller has already proven a code/password). */
export async function regenerateRecoveryCodes(prisma: AnyPrismaClient, adminId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await prisma.admin.update({ where: { id: adminId }, data: { recoveryCodeHashes: codes.map(hashRecoveryCode) } });
    return codes;
}

/** OWNER-set platform policy: every admin must have 2FA enabled. */
export async function isTwoFactorRequired(prisma: AnyPrismaClient): Promise<boolean> {
    const v = (await getPlatformSetting(prisma, REQUIRE_2FA_KEY)) as { enabled?: unknown } | null;
    return v?.enabled === true;
}
