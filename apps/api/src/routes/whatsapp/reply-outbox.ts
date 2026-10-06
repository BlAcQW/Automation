/**
 * Outbox for agent replies.
 *
 * Problem: the agent turn has side effects (create_booking, payment links...)
 * that must not run twice, yet the reply it produced can fail to SEND. If a
 * send failure were swallowed the inbound would be marked handled and the
 * customer would never hear back; if it simply threw, the retry would re-run
 * the whole agent turn.
 *
 * So the reply text is persisted as an OUTBOUND Message row BEFORE the send:
 *   sendState SENDING    claimed by one sender (sendClaimedAt); a claim older
 *                        than SEND_CLAIM_STALE_MS is presumed abandoned
 *   sendState PENDING    stored, not being sent (a retryable send failed)
 *   sendState SENT       provider accepted it (whatsappMsgId recorded)
 *   sendState SUPPRESSED deliberately not sent (quota, channel unconfigured,
 *                        permanently undeliverable, staff took over)
 * `replyToId` links it to the inbound message it answers. Sending requires
 * winning an atomic claim, so two workers can never both send one row.
 *
 * A reply that exists in ANY final state (SENT / SUPPRESSED) means the turn
 * already happened: a retry must not run the agent again (its tools may have
 * acted), even if marking the inbound handled failed.
 *
 * Not covered on purpose: if storing the row itself fails, the agent's reply
 * is lost and the caller's fallback hands the conversation to a human with a
 * holding message. Retrying instead would re-run the agent and repeat its side
 * effects, which is worse than a human picking it up.
 *
 * On send failure the row stays PENDING and ReplySendError is thrown, which
 * leaves the inbound unhandled so the inbox row retries with backoff. The retry
 * calls resendPendingReply BEFORE the agent: it re-sends exactly the stored
 * text. Quota is reserved per send attempt and rolled back when that attempt
 * fails.
 *
 * Known trade-off (same as inbound-store.ts): a crash after the provider
 * accepted the message but before the row is marked SENT yields one duplicate
 * on retry. Preferred over a lost reply.
 */

import { sendChannelText, ChannelSendError, type ChannelCredentials } from '../../services/channel-send.js';
import { tryReserveOutbound, rollbackOutboundReservation } from '../../services/usage.js';
import { raiseAlert } from '../../services/alerts.js';

export type OutboxChannel = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';

/** The reply could not be sent and is stored PENDING; the turn must be retried, not handled. */
export class ReplySendError extends Error {
    constructor(public readonly channel: OutboxChannel, public readonly cause: unknown) {
        super(`reply_send_failed_${channel.toLowerCase()}: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'ReplySendError';
    }
}

export type DeliveryOutcome = 'sent' | 'suppressed' | 'no_channel' | 'undeliverable';

/** A SENDING claim older than this is presumed abandoned (sender crashed). Send timeout is 15s. */
export const SEND_CLAIM_STALE_MS = 2 * 60_000;

/**
 * True when retrying the send can never succeed: a configuration error, or a
 * 4xx from the provider other than rate limiting / request timeout (invalid
 * recipient, closed 24h window, bad token...). Network errors and 5xx retry.
 */
export function isPermanentSendFailure(err: unknown): boolean {
    if (!(err instanceof ChannelSendError)) return false;
    if (err.step === 'config') return true;
    const m = /^http_(\d{3})/.exec(err.details);
    if (!m) return false;
    const status = Number(m[1]);
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export interface DeliverArgs {
    conversationId: string;
    channel: OutboxChannel;
    /** null = channel not configured for this tenant. */
    creds: ChannelCredentials | null;
    recipientId: string;
    text: string;
    inboundId?: string;
    metadata: Record<string, unknown>;
    /** Resend of an already stored row this caller has CLAIMED (no new row is created). */
    existingRowId?: string;
}

async function setState(fastify: any, id: string | undefined, data: Record<string, unknown>): Promise<void> {
    if (!id) return;
    try {
        await fastify.prisma.message.update({ where: { id }, data });
    } catch (err) {
        fastify.log.error({ err, messageId: id, data }, 'Could not update reply outbox row');
    }
}

export async function deliverReply(fastify: any, tenant: any, args: DeliverArgs): Promise<DeliveryOutcome> {
    const { channel } = args;
    let rowId = args.existingRowId;

    if (!args.creds) {
        // Channel not configured: a deliberate no-reply, but someone should know.
        fastify.log.warn({ tenantId: tenant.id, channel }, 'Reply not sent: channel not configured');
        await raiseAlert(fastify.prisma, {
            kind: 'outbound.no_channel',
            severity: 'warning',
            tenantId: tenant.id,
            message: `Replies on ${channel} cannot be sent: the channel is not configured`,
            context: { channel },
            dedupeKey: `outbound.no_channel:${tenant.id}:${channel}`,
        });
        await setState(fastify, rowId, { sendState: 'SUPPRESSED', sendClaimedAt: null });
        return 'no_channel';
    }

    // check-then-increment is not safe under concurrency (see usage.ts);
    // reserve atomically and release when this attempt fails.
    const reservation = await tryReserveOutbound(fastify.prisma, tenant.id);
    if (!reservation.ok) {
        fastify.log.warn({ tenantId: tenant.id }, 'Quota exhausted — agent reply suppressed');
        await setState(fastify, rowId, { sendState: 'SUPPRESSED', sendClaimedAt: null });
        return 'suppressed';
    }

    if (!rowId) {
        try {
            const row = await fastify.prisma.message.create({
                data: {
                    conversationId: args.conversationId,
                    direction: 'OUTBOUND',
                    content: args.text,
                    messageType: 'TEXT',
                    whatsappMsgId: null,
                    replyToId: args.inboundId ?? null,
                    // Created already claimed: this caller is the sender.
                    sendState: 'SENDING',
                    sendClaimedAt: new Date(),
                    metadata: args.metadata,
                },
            });
            rowId = row?.id;
        } catch (err) {
            // Nothing was sent; do not send what we could not store.
            await rollbackOutboundReservation(fastify.prisma, tenant.id).catch(() => undefined);
            throw err;
        }
    }

    let providerMessageId: string | undefined;
    try {
        const sent = await sendChannelText({
            channel,
            credentials: args.creds,
            recipientId: args.recipientId,
            text: args.text,
        });
        providerMessageId = sent.messageId;
    } catch (err) {
        await rollbackOutboundReservation(fastify.prisma, tenant.id).catch(() => undefined);
        if (isPermanentSendFailure(err)) {
            fastify.log.error({ err, channel, messageId: rowId }, 'Agent reply is undeliverable; not retrying');
            await setState(fastify, rowId, { sendState: 'SUPPRESSED', sendClaimedAt: null });
            await raiseAlert(fastify.prisma, {
                kind: 'outbound.undeliverable',
                severity: 'warning',
                tenantId: tenant.id,
                message: `A reply on ${channel} could not be delivered and will not be retried`,
                context: { channel, messageId: rowId ?? null, detail: (err as ChannelSendError).details },
                dedupeKey: `outbound.undeliverable:${rowId ?? `${tenant.id}:${args.conversationId}`}`,
            });
            return 'undeliverable';
        }
        fastify.log.error({ err, channel, messageId: rowId }, 'Failed to send agent reply; stored PENDING for retry');
        // Release the claim so a retry can take it.
        await setState(fastify, rowId, { sendState: 'PENDING', sendClaimedAt: null });
        throw new ReplySendError(channel, err);
    }

    // The customer has it. A failure here only risks a duplicate on retry.
    await setState(fastify, rowId, { sendState: 'SENT', sendClaimedAt: null, whatsappMsgId: providerMessageId ?? null });
    return 'sent';
}

/**
 * Retry hook, run BEFORE the agent on a retried (unhandled) inbound.
 *
 * Returns true = the turn is already accounted for, mark the inbound handled
 * and skip the agent; false = no reply was ever stored, run the turn. Throws
 * ReplySendError when another worker is mid-send or the re-send failed
 * retryably, so the inbox row retries later.
 */
export async function resendPendingReply(
    fastify: any,
    tenant: any,
    args: {
        conversationId: string;
        inboundId: string | undefined;
        channel: OutboxChannel;
        creds: ChannelCredentials | null;
        recipientId: string;
        /** Staff took over since the failed attempt: never send a stale bot reply. */
        humanActive?: boolean;
    },
): Promise<boolean> {
    if (!args.inboundId) return false;
    const reply = await fastify.prisma.message.findFirst({
        where: { conversationId: args.conversationId, replyToId: args.inboundId, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, sendState: true, sendClaimedAt: true },
    });
    if (!reply) return false;

    // The turn already produced its outcome; never run the agent again.
    if (reply.sendState === 'SENT' || reply.sendState === 'SUPPRESSED') return true;

    if (args.humanActive) {
        await fastify.prisma.message.updateMany({
            where: { id: reply.id, sendState: 'PENDING' },
            data: { sendState: 'SUPPRESSED', sendClaimedAt: null },
        });
        return true;
    }

    // Atomic claim: only one worker may send this row. A fresh SENDING claim
    // belongs to someone else; a stale one is taken over.
    const staleBefore = new Date(Date.now() - SEND_CLAIM_STALE_MS);
    const claimed = await fastify.prisma.message.updateMany({
        where: {
            id: reply.id,
            OR: [{ sendState: 'PENDING' }, { sendState: 'SENDING', sendClaimedAt: { lt: staleBefore } }],
        },
        data: { sendState: 'SENDING', sendClaimedAt: new Date() },
    });
    if (claimed.count !== 1) {
        throw new ReplySendError(args.channel, new Error('reply is being sent by another worker'));
    }

    await deliverReply(fastify, tenant, {
        conversationId: args.conversationId,
        channel: args.channel,
        creds: args.creds,
        recipientId: args.recipientId,
        text: reply.content,
        inboundId: args.inboundId,
        metadata: {},
        existingRowId: reply.id,
    });
    return true;
}
