/**
 * Promo codes.
 *
 * An admin creates a code; a business owner types it into Settings. Two
 * kinds exist today, and both work the same way underneath: the tenant is
 * put on a plan as TRIALING with an end date pushed out by `days`. When the
 * date passes, the existing subscription evaluator drops them to Free like
 * any other trial. No new billing state to maintain.
 *
 *   TRIAL_EXTENSION  keep the plan they are trialling (Pro if they have
 *                    lapsed to Free) and add `days`
 *   PLAN_GRANT       put them on `planId` for `days`
 *
 * Percentage discounts belong at checkout and wait for self-serve billing.
 */

import { randomBytes } from 'node:crypto';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { getPlan, PLAN_IDS } from './plans.js';

// No 0/O/1/I: codes get read out loud and typed on phones.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePromoCode(prefix = '', length = 8): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
    const p = normalizePromoCode(prefix);
    return p ? `${p}-${out}` : out;
}

/** Upper-case, strip spaces and anything that is not a letter, digit or hyphen. */
export function normalizePromoCode(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
}

export type RedeemFailure =
    | 'not_found'
    | 'inactive'
    | 'expired'
    | 'exhausted'
    | 'already_redeemed'
    | 'active_subscription';

export type RedeemResult =
    | { ok: true; planId: string; planName: string; days: number; endsAt: Date }
    | { ok: false; reason: RedeemFailure };

export const REDEEM_MESSAGES: Record<RedeemFailure, string> = {
    not_found: 'That code does not exist. Check the spelling and try again.',
    inactive: 'That code is no longer active.',
    expired: 'That code has expired.',
    exhausted: 'That code has been used the maximum number of times.',
    already_redeemed: 'You have already used this code.',
    active_subscription: 'Promo codes cannot be applied to a paid subscription. Contact support and we will sort it out.',
};

interface Tenantish {
    planId: string;
    subscriptionStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;
    trialEndsAt: Date | null;
}

interface Promoish {
    kind: 'TRIAL_EXTENSION' | 'PLAN_GRANT';
    days: number;
    planId: string | null;
}

/** Pure: what a redemption does to a tenant. Exported for tests. */
export function applyPromo(tenant: Tenantish, promo: Promoish, now = new Date()): { planId: string; trialEndsAt: Date } {
    const trialing = tenant.subscriptionStatus === 'TRIALING' && tenant.trialEndsAt && tenant.trialEndsAt > now;
    const base = trialing ? (tenant.trialEndsAt as Date) : now;
    const endsAt = new Date(base.getTime() + promo.days * 86_400_000);

    let planId: string;
    if (promo.kind === 'PLAN_GRANT' && promo.planId && (PLAN_IDS as readonly string[]).includes(promo.planId)) {
        planId = promo.planId;
    } else {
        // Extending a trial keeps whatever they are trialling; a lapsed or
        // free account gets Pro, which is what the sign-up trial gives.
        planId = trialing && tenant.planId !== 'free' ? tenant.planId : 'pro';
    }
    return { planId, trialEndsAt: endsAt };
}

export async function redeemPromoCode(args: {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    code: string;
    now?: Date;
}): Promise<RedeemResult> {
    const { prisma, tenantId } = args;
    const now = args.now ?? new Date();
    const code = normalizePromoCode(args.code);
    if (!code) return { ok: false, reason: 'not_found' };

    const promo = await prisma.promoCode.findUnique({ where: { code } });
    if (!promo) return { ok: false, reason: 'not_found' };
    if (!promo.isActive) return { ok: false, reason: 'inactive' };
    if (promo.expiresAt && promo.expiresAt < now) return { ok: false, reason: 'expired' };
    if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
        return { ok: false, reason: 'exhausted' };
    }

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { planId: true, subscriptionStatus: true, trialEndsAt: true },
    });
    if (!tenant) return { ok: false, reason: 'not_found' };
    if (tenant.subscriptionStatus === 'ACTIVE' || tenant.subscriptionStatus === 'PAST_DUE') {
        return { ok: false, reason: 'active_subscription' };
    }

    const already = await prisma.promoRedemption.findUnique({
        where: { promoCodeId_tenantId: { promoCodeId: promo.id, tenantId } },
        select: { id: true },
    });
    if (already) return { ok: false, reason: 'already_redeemed' };

    const effect = applyPromo(tenant, promo, now);

    // One transaction: bump the counter only if still under the cap, so two
    // tenants racing for the last redemption cannot both win.
    const applied = await prisma.$transaction(async (tx) => {
        const bumped = await tx.promoCode.updateMany({
            where: {
                id: promo.id,
                isActive: true,
                ...(promo.maxRedemptions !== null ? { redemptionCount: { lt: promo.maxRedemptions } } : {}),
            },
            data: { redemptionCount: { increment: 1 } },
        });
        if (bumped.count === 0) return false;

        await tx.promoRedemption.create({
            data: {
                promoCodeId: promo.id,
                tenantId,
                effect: {
                    from: { planId: tenant.planId, status: tenant.subscriptionStatus, trialEndsAt: tenant.trialEndsAt },
                    to: { planId: effect.planId, trialEndsAt: effect.trialEndsAt },
                },
            },
        });
        await tx.tenant.update({
            where: { id: tenantId },
            data: { planId: effect.planId, subscriptionStatus: 'TRIALING', trialEndsAt: effect.trialEndsAt },
        });
        return true;
    });
    if (!applied) return { ok: false, reason: 'exhausted' };

    return {
        ok: true,
        planId: effect.planId,
        planName: getPlan(effect.planId).name,
        days: promo.days,
        endsAt: effect.trialEndsAt,
    };
}
