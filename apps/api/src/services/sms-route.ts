/**
 * Whose Arkesel account an SMS is sent from.
 *
 * Same principle as payments: a salon owner should never have to open an SMS
 * gateway account, find an API key and paste it into a settings page. By
 * default messages go out on BOOKLY's account.
 *
 * Tenants who already configured their own keep using it. Their sender ID is
 * their brand in the recipient's inbox, and silently replacing it would change
 * what their customers see.
 *
 * WHY THE BUDGET EXISTS
 * ---------------------
 * Platform SMS is Bookly's money, spent per message. Without a per-tenant cap
 * a single busy — or misbehaving — tenant spends the whole budget and every
 * other tenant's reminders stop.
 */

import { decrypt } from './crypto.js';

export type SmsRouteKind = 'PLATFORM' | 'OWN_ACCOUNT';

export interface SmsRoute {
    route: SmsRouteKind;
    apiKey: string;
    senderId: string;
}

export interface SmsRouteTenant {
    arkeselApiKey: string | null | undefined;
    arkeselSenderId: string | null | undefined;
}

export interface PlatformSmsCredentials {
    apiKey: string;
    senderId: string;
}

/** Monthly platform-funded SMS per tenant, before we stop sending. */
export const DEFAULT_MONTHLY_SMS_BUDGET = 200;

/**
 * Pick the account, or null when no SMS can be sent at all.
 *
 * A tenant with a key but no sender ID counts as unconfigured: Arkesel
 * rejects a send with no sender, so treating them as configured would just
 * fail silently.
 */
export function resolveSmsRoute(
    tenant: SmsRouteTenant,
    platform: PlatformSmsCredentials | null | undefined,
    decryptFn: (value: string) => string = decrypt,
): SmsRoute | null {
    if (tenant.arkeselApiKey && tenant.arkeselSenderId) {
        try {
            const apiKey = decryptFn(tenant.arkeselApiKey);
            if (apiKey) {
                return { route: 'OWN_ACCOUNT', apiKey, senderId: tenant.arkeselSenderId };
            }
        } catch {
            // A rotated or corrupt key must not stop reminders going out.
        }
    }

    if (platform?.apiKey && platform.senderId) {
        return { route: 'PLATFORM', apiKey: platform.apiKey, senderId: platform.senderId };
    }
    return null;
}

/** Has this tenant used up their platform-funded allowance? */
export function withinSmsBudget(input: { sentThisCycle: number; budget: number }): boolean {
    return input.sentThisCycle < input.budget;
}
