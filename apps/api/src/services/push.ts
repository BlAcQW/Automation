import type { ExtendedPrismaClient } from '../plugins/prisma.js';

/**
 * Expo push delivery. The mobile app registers an Expo push token
 * (`ExponentPushToken[...]`) via POST /devices/register; this module fans a
 * notification out to every registered device of a tenant's owners/staff.
 *
 * Best-effort by design: push must never break the request that created the
 * underlying in-app Notification, so every failure is swallowed and logged.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const EXPO_BATCH_SIZE = 100; // Expo accepts up to 100 messages per request

export interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, unknown>;
}

export interface ExpoMessage {
    to: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    sound: 'default';
}

/**
 * Pure: filter a list of raw device tokens down to valid Expo push tokens and
 * shape them into Expo message objects. Exported for unit testing.
 */
export function buildExpoMessages(tokens: string[], payload: PushPayload): ExpoMessage[] {
    return tokens
        .filter((token) => EXPO_TOKEN_RE.test(token))
        .map((to) => ({
            to,
            title: payload.title,
            body: payload.body,
            data: payload.data ?? {},
            sound: 'default' as const,
        }));
}

interface PushLogger {
    warn: (obj: unknown, msg?: string) => void;
}

/**
 * Send a push notification to all of a tenant's registered devices.
 * Never throws.
 */
export async function sendPushToTenant(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    payload: PushPayload,
    logger?: PushLogger,
): Promise<void> {
    try {
        const devices = await prisma.deviceToken.findMany({
            where: { tenantId },
            select: { token: true },
        });

        const messages = buildExpoMessages(devices.map((d) => d.token), payload);

        if (messages.length === 0) return;

        for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
            const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
            const res = await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(batch),
            });
            if (!res.ok) {
                logger?.warn({ status: res.status, count: batch.length }, 'Expo push batch failed');
            }
        }
    } catch (err) {
        logger?.warn({ err }, 'sendPushToTenant threw');
    }
}
