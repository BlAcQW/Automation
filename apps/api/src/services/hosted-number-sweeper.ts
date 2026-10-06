/**
 * Release Bookly-hosted numbers whose onboarding was abandoned.
 *
 * A hosted number occupies one of the 20 slots on Bookly's WABA from the
 * moment it is created, before the owner has entered the OTP. An organisation
 * that never finishes (or a bad actor starting and walking away) would
 * otherwise hold slots forever. Any number still PENDING_CODE / VERIFIED
 * HOSTED_PENDING_TTL_MS after its last code was sent is cleared from the
 * tenant and deleted from our WABA. The owner can simply start again.
 *
 * Also frees a STARTING claim left behind by a crashed /hosted/start.
 *
 * MULTI-PROCESS SAFETY: each release is a guarded
 *   updateMany WHERE id AND phoneNumberId AND status pending AND codeSentAt < cutoff
 * and only the process whose update returned count 1 deletes the number and
 * audits, so two sweepers never double-delete or double-audit.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { audit } from './audit.js';
import { raiseAlert } from './alerts.js';
import { createNotification } from './notifications.js';
import { deleteHostedNumber, isPlatformWabaConfigured } from './meta-number-onboarding.js';
import { CLEARED_WHATSAPP, HOSTED_PENDING_TTL_MS, PENDING_HOSTED_STATUSES } from './whatsapp-connection.js';

const SWEEP_EVERY_MS = 5 * 60_000;
const BATCH = 50;
const STALE_STARTING_MS = 10 * 60_000;

type Log = Pick<FastifyBaseLogger, 'warn' | 'error'>;

export async function releaseStaleHostedNumbers(
    prisma: ExtendedPrismaClient,
    log?: Log,
    now: Date = new Date(),
): Promise<{ released: number; failedDeletes: number }> {
    const cutoff = new Date(now.getTime() - HOSTED_PENDING_TTL_MS);
    const stale = {
        whatsappHosted: true,
        whatsappNumberStatus: { in: [...PENDING_HOSTED_STATUSES] },
        OR: [{ whatsappCodeSentAt: null }, { whatsappCodeSentAt: { lt: cutoff } }],
    };

    await prisma.tenant.updateMany({
        where: { whatsappNumberStatus: 'STARTING', whatsappPhoneNumberId: null, whatsappCodeSentAt: { lt: new Date(now.getTime() - STALE_STARTING_MS) } },
        data: { whatsappNumberStatus: null, whatsappCodeSentAt: null },
    });

    const candidates = await prisma.tenant.findMany({
        where: { ...stale, whatsappPhoneNumberId: { not: null } },
        orderBy: { whatsappCodeSentAt: 'asc' },
        take: BATCH,
        select: { id: true, whatsappPhoneNumberId: true, whatsappDisplayNumber: true, whatsappNumberStatus: true },
    });

    let released = 0;
    let failedDeletes = 0;
    for (const c of candidates) {
        const phoneNumberId = c.whatsappPhoneNumberId!;
        const claim = await prisma.tenant.updateMany({ where: { id: c.id, whatsappPhoneNumberId: phoneNumberId, ...stale }, data: CLEARED_WHATSAPP });
        if (claim.count !== 1) continue; // verified meanwhile, or another sweeper took it
        released += 1;

        let deleted = false;
        if (isPlatformWabaConfigured()) {
            try {
                await deleteHostedNumber(phoneNumberId);
                deleted = true;
            } catch (err) {
                failedDeletes += 1;
                log?.error({ reason: (err as Error).message, phoneNumberId }, 'failed to delete expired hosted number');
                await raiseAlert(prisma, {
                    kind: 'whatsapp.hosted_release_failed',
                    severity: 'warning',
                    tenantId: c.id,
                    dedupeKey: `whatsapp.hosted_release_failed:${phoneNumberId}`,
                    message: `An abandoned Bookly-hosted number (${c.whatsappDisplayNumber ?? phoneNumberId}) could not be deleted from Bookly's WABA and still holds a slot. Delete it in WhatsApp Manager.`,
                    context: { phoneNumberId, displayNumber: c.whatsappDisplayNumber },
                });
            }
        }

        await audit({
            prisma,
            action: 'whatsapp.hosted_expired',
            actorType: 'SYSTEM',
            tenantId: c.id,
            metadata: { phoneNumberId, displayNumber: c.whatsappDisplayNumber, status: c.whatsappNumberStatus, deletedFromWaba: deleted },
        });
        try {
            await createNotification(prisma, {
                tenantId: c.id,
                type: 'SYSTEM',
                title: 'WhatsApp setup expired',
                message: `The verification for ${c.whatsappDisplayNumber ?? 'your number'} was not finished within 30 minutes, so it was cancelled. Start again whenever you are ready.`,
                metadata: { kind: 'whatsapp.hosted_expired' },
            });
        } catch (err) {
            log?.warn({ err, tenantId: c.id }, 'hosted expiry notification failed');
        }
    }
    return { released, failedDeletes };
}

export function startHostedNumberSweeper(prisma: ExtendedPrismaClient, log: FastifyBaseLogger): () => void {
    const timer = setInterval(() => {
        releaseStaleHostedNumbers(prisma, log).catch((err) => log.error({ err }, 'Hosted number sweep failed'));
    }, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
