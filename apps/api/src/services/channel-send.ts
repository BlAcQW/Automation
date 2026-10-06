/**
 * Sending a message on whichever channel the customer used.
 *
 * The three channels differ only in endpoint, payload envelope and which token
 * signs the call. Everything above this — the agent, the booking tools, the
 * deposit links — is channel-agnostic already, so this is the whole of the
 * difference between "WhatsApp bot" and "WhatsApp, Instagram and Messenger
 * bot".
 *
 * WHAT DIFFERS THAT CALLERS MUST KNOW
 * -----------------------------------
 * Meta charges nothing per message on Instagram or Messenger, so the WhatsApp
 * quota and 24-hour template machinery do not apply there. The 24-hour reply
 * window still does, but there is no template escape hatch: a reminder that
 * falls outside it cannot be sent on those channels at all and has to go by
 * SMS instead. Callers scheduling out-of-window messages must check the
 * channel rather than assuming a template will save them.
 */

import type { ConversationChannel } from '@prisma/client';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** A hung Graph call must not hold the conversation lock and a worker slot forever. */
export const SEND_TIMEOUT_MS = 15_000;

export type ChannelSendStep = 'config' | 'send';

export class ChannelSendError extends Error {
    constructor(
        public readonly channel: ConversationChannel,
        public readonly step: ChannelSendStep,
        public readonly details: string,
    ) {
        super(`channel_send_${channel.toLowerCase()}_${step}: ${details}`);
        this.name = 'ChannelSendError';
    }
}

export interface ChannelCredentials {
    /** WhatsApp: phone number id. Messenger: Page id. Instagram: IG user id. */
    senderId: string;
    accessToken: string;
}

export interface SendTextArgs {
    channel: ConversationChannel;
    credentials: ChannelCredentials;
    /** Phone (WhatsApp) or scoped id — the conversation's `externalId`. */
    recipientId: string;
    text: string;
}

/**
 * Build the Graph request for a text message. Exported separately from the
 * fetch so the per-channel shapes can be asserted without network access —
 * these envelopes are easy to get subtly wrong and fail only at runtime.
 */
export function buildTextRequest(args: SendTextArgs): { url: string; body: Record<string, unknown> } {
    const { channel, credentials, recipientId, text } = args;

    if (channel === 'WHATSAPP') {
        return {
            url: `${GRAPH_BASE}/${credentials.senderId}/messages`,
            body: {
                messaging_product: 'whatsapp',
                to: recipientId,
                type: 'text',
                text: { body: text },
            },
        };
    }

    // Messenger and Instagram share the Send API envelope. `messaging_type:
    // RESPONSE` marks this as a reply inside the 24-hour window, which is the
    // only thing the bot ever sends.
    return {
        url: `${GRAPH_BASE}/${credentials.senderId}/messages`,
        body: {
            recipient: { id: recipientId },
            message: { text },
            messaging_type: 'RESPONSE',
        },
    };
}

/** Send a text message, returning the provider message id where one is given. */
export async function sendChannelText(args: SendTextArgs): Promise<{ messageId?: string }> {
    if (!args.credentials.senderId || !args.credentials.accessToken) {
        throw new ChannelSendError(args.channel, 'config', 'missing sender id or access token');
    }

    const { url, body } = buildTextRequest(args);

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.credentials.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
    } catch (err) {
        throw new ChannelSendError(args.channel, 'send', `network_error: ${(err as Error).message}`);
    }

    const raw = await response.text().catch(() => '');
    if (!response.ok) {
        throw new ChannelSendError(args.channel, 'send', `http_${response.status}: ${raw.slice(0, 400)}`);
    }

    try {
        const parsed = JSON.parse(raw || '{}') as {
            messages?: Array<{ id?: string }>;
            message_id?: string;
        };
        return { messageId: parsed.messages?.[0]?.id ?? parsed.message_id };
    } catch {
        return {};
    }
}

/**
 * Can this channel deliver a message when the 24-hour window has closed?
 *
 * WhatsApp can, using an approved template. Instagram and Messenger cannot in
 * any way that suits an appointment reminder, so callers should fall back to
 * SMS rather than queue something that will be rejected.
 */
export function supportsOutOfWindowMessaging(channel: ConversationChannel): boolean {
    return channel === 'WHATSAPP';
}


/**
 * Work out which sender id and token to use for a tenant on a given channel.
 *
 * WhatsApp goes through the existing resolver (which handles hosted numbers
 * using the platform token). Messenger sends as the Page; Instagram sends as
 * the IG user — but both are signed by the same Page access token, because
 * Instagram messaging is delivered through the linked Page.
 */
export function resolveChannelCredentials(
    tenant: {
        facebookPageId?: string | null;
        facebookPageToken?: string | null;
        instagramUserId?: string | null;
    },
    channel: ConversationChannel,
    decryptFn: (v: string) => string,
    whatsappCreds?: { phoneNumberId: string; accessToken: string } | null,
): ChannelCredentials | null {
    if (channel === 'WHATSAPP') {
        return whatsappCreds
            ? { senderId: whatsappCreds.phoneNumberId, accessToken: whatsappCreds.accessToken }
            : null;
    }

    if (!tenant.facebookPageToken) return null;
    const token = decryptFn(tenant.facebookPageToken);

    if (channel === 'MESSENGER') {
        return tenant.facebookPageId ? { senderId: tenant.facebookPageId, accessToken: token } : null;
    }
    return tenant.instagramUserId ? { senderId: tenant.instagramUserId, accessToken: token } : null;
}
