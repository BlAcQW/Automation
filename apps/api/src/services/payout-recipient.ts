/**
 * Where a tenant's money goes when they withdraw.
 *
 * The owner gives one thing: the Mobile Money number they already use. No
 * gateway account, no keys, no dashboard on someone else's website. Paystack
 * resolves the account name so they can see it is really theirs before
 * confirming.
 *
 * THE THREAT THIS FILE IS SHAPED AROUND
 * -------------------------------------
 * Account takeover does not steal the login to read the diary. It changes
 * where the money goes and then withdraws. So changing an existing
 * destination is treated as a security event: the new number cannot receive
 * anything for a cooling-off window, the change is audited, and the owner is
 * told. A FIRST destination is not that attack — there is nothing to replace
 * and usually nothing yet to steal — so it works immediately rather than
 * punishing an honest owner on their first payday.
 */

import { PaystackError } from './paystack.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

/** How long a REPLACEMENT destination is unusable. */
export const COOLING_OFF_HOURS = 24;

export interface CoolingOffInput {
    /** True when the tenant already had a destination. */
    isReplacement: boolean;
}

/** When a newly saved destination becomes payable. */
export function coolingOffUntil(input: CoolingOffInput, now: Date = new Date()): Date {
    if (!input.isReplacement) return now;
    return new Date(now.getTime() + COOLING_OFF_HOURS * 3600_000);
}

export interface UsableDestination {
    usableFrom: Date;
    archivedAt: Date | null;
}

/** Can money be sent here right now? */
export function destinationIsUsable(
    destination: UsableDestination | null | undefined,
    now: Date = new Date(),
): boolean {
    if (!destination) return false;
    if (destination.archivedAt) return false;
    return destination.usableFrom.getTime() <= now.getTime();
}

async function paystackGet<T>(path: string, secretKey: string, step: 'providers' | 'resolve'): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${PAYSTACK_BASE}${path}`, {
            headers: { Authorization: `Bearer ${secretKey}` },
        });
    } catch (err) {
        throw new PaystackError('config', `${step}_network_error: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as
        | { status?: boolean; message?: string; data?: T }
        | null;
    if (!res.ok || !body?.status || body.data === undefined) {
        throw new PaystackError('config', body?.message ?? `${step}_http_${res.status}`);
    }
    return body.data;
}

export interface MomoProvider {
    /** Paystack's code for the telco, e.g. MTN. */
    code: string;
    name: string;
}

/**
 * The Mobile Money networks a tenant can be paid on.
 *
 * Fetched rather than hard-coded: telco codes change, and a stale list means
 * a payout that silently fails at the provider.
 */
export async function listMomoProviders(
    secretKey: string,
    currency = 'GHS',
): Promise<MomoProvider[]> {
    const data = await paystackGet<Array<{ code?: string; name?: string }>>(
        `/bank?currency=${encodeURIComponent(currency)}&type=mobile_money`,
        secretKey,
        'providers',
    );
    return data
        .filter((b) => b.code && b.name)
        .map((b) => ({ code: b.code as string, name: b.name as string }));
}

/**
 * Ask Paystack whose account a number belongs to.
 *
 * Shown back to the owner before they confirm, so a typo becomes a visible
 * wrong name rather than money sent to a stranger. Paystack will not take
 * responsibility for a payout to the wrong account, so this check is ours.
 */
export async function resolveAccountName(
    secretKey: string,
    accountNumber: string,
    bankCode: string,
): Promise<string | null> {
    try {
        const data = await paystackGet<{ account_name?: string }>(
            `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
            secretKey,
            'resolve',
        );
        return data.account_name ?? null;
    } catch {
        // Resolution is a safety net, not a gate: some networks do not support
        // it. The owner still confirms the number itself.
        return null;
    }
}

export interface CreatedRecipient {
    recipientCode: string;
    accountName: string;
}

/**
 * Register the destination with Paystack and get back the code that payouts
 * are addressed to.
 */
export async function createTransferRecipient(args: {
    secretKey: string;
    name: string;
    accountNumber: string;
    bankCode: string;
    currency?: string;
}): Promise<CreatedRecipient> {
    let res: Response;
    try {
        res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: 'mobile_money',
                name: args.name,
                account_number: args.accountNumber,
                bank_code: args.bankCode,
                currency: args.currency ?? 'GHS',
            }),
        });
    } catch (err) {
        throw new PaystackError('config', `recipient_network_error: ${(err as Error).message}`);
    }

    const body = (await res.json().catch(() => null)) as
        | { status?: boolean; message?: string; data?: { recipient_code?: string; details?: { account_name?: string } } }
        | null;

    if (!res.ok || !body?.status || !body.data?.recipient_code) {
        throw new PaystackError('config', body?.message ?? `recipient_http_${res.status}`);
    }

    return {
        recipientCode: body.data.recipient_code,
        accountName: body.data.details?.account_name ?? args.name,
    };
}
