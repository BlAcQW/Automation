/**
 * Sending credentials for a tenant on one channel (WhatsApp, Instagram or
 * Messenger), or null when that channel is not configured.
 *
 * One place so the webhook turns, the flow payment fulfiller and anything else
 * that replies on a customer's channel resolve them identically.
 */
import type { ConversationChannel } from '@prisma/client';
import { resolveChannelCredentials, type ChannelCredentials } from './channel-send.js';
import { decrypt } from './crypto.js';
import { resolveCredentials, selectCredentialSource } from './whatsapp-credentials.js';

export function tenantChannelCreds(tenant: any, channel: ConversationChannel): ChannelCredentials | null {
    return resolveChannelCredentials(tenant, channel, decrypt, resolveCredentials(selectCredentialSource(tenant)));
}
