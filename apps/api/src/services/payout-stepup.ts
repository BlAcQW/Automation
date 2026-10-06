/**
 * Step-up authentication for the two actions that move money out: withdrawing,
 * and changing where it goes.
 *
 * A stolen session (an unlocked laptop, a leaked refresh token) is enough to
 * click "withdraw". Asking for the password again makes the attacker need the
 * credential, not just the session. It is checked server-side against the
 * stored hash; the client merely sends what the owner typed.
 */

import bcrypt from 'bcryptjs';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { clearFailures, isLocked, recordFailure, type ThrottleRedis } from './admin-throttle.js';

/** bcrypt only reads 72 bytes anyway; refuse absurd input before hashing it. */
const MAX_PASSWORD_LENGTH = 200;

/**
 * Lockout: a stolen session must not be able to guess the password at the rate
 * of the route's rate limit for ever. After this many consecutive wrong
 * passwords for one user, step-up is refused for STEPUP_LOCK_MS, even for the
 * right password. Per tenant user (not per IP), kept in Redis when the caller
 * passes it so it holds across instances, in memory otherwise (admin-throttle.ts).
 * A success clears the count.
 */
export const STEPUP_MAX_FAILURES = 5;
export const STEPUP_LOCK_MS = 15 * 60_000;
const POLICY = { max: STEPUP_MAX_FAILURES, lockMs: STEPUP_LOCK_MS };
const lockKeyFor = (tenantId: string, userId: string) => `stepup:${tenantId}:${userId}`;

export type StepUpResult =
    | { ok: true }
    | { ok: false; reason: 'incorrect' }
    | { ok: false; reason: 'locked'; retryAfterSec: number };

export interface StepUpArgs {
    tenantId: string;
    userId: string;
    password: unknown;
    redis?: ThrottleRedis | null;
    /** Test clock. */
    now?: number;
}

/** Like verifyStepUp, but says WHY it refused so the caller can answer honestly. */
export async function checkStepUp(prisma: ExtendedPrismaClient, args: StepUpArgs): Promise<StepUpResult> {
    const { password, redis } = args;
    const now = args.now ?? Date.now();
    const key = lockKeyFor(args.tenantId, args.userId);

    if (await isLocked(redis, key, now)) {
        return { ok: false, reason: 'locked', retryAfterSec: Math.ceil(STEPUP_LOCK_MS / 1000) };
    }
    // Not an attempt at a password: nothing to count.
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
        return { ok: false, reason: 'incorrect' };
    }
    const user = await prisma.user.findFirst({
        where: { id: args.userId, tenantId: args.tenantId },
        select: { passwordHash: true, isActive: true },
    });
    // A deactivated user must not move money on a session that outlived the
    // deactivation. Answered like a wrong password: no account-state oracle.
    if (!user?.passwordHash || user.isActive === false) return { ok: false, reason: 'incorrect' };

    let matches = false;
    try {
        matches = await bcrypt.compare(password, user.passwordHash);
    } catch {
        matches = false;
    }
    if (matches) {
        await clearFailures(redis, key);
        return { ok: true };
    }
    await recordFailure(redis, key, POLICY, now);
    return { ok: false, reason: 'incorrect' };
}

export async function verifyStepUp(prisma: ExtendedPrismaClient, args: StepUpArgs): Promise<boolean> {
    return (await checkStepUp(prisma, args)).ok;
}
