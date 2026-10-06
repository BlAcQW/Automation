import crypto from 'node:crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

export type PaystackStep = 'initialize' | 'verify' | 'signature' | 'config' | 'refund';

export class PaystackError extends Error {
    constructor(public readonly step: PaystackStep, public readonly details: string) {
        super(`paystack_${step}: ${details}`);
        this.name = 'PaystackError';
    }
}

export interface InitializeArgs {
    secretKey: string; // decrypted tenant key
    email: string;
    amountKobo: number; // integer subunit
    currency: string; // 'NGN', 'GHS', 'USD', ...
    reference: string;
    callbackUrl?: string;
    metadata: Record<string, unknown>;
}

export interface InitializeResult {
    authorizationUrl: string;
    reference: string;
    accessCode: string;
}

export interface VerifyResult {
    status: 'success' | 'failed' | 'abandoned' | 'pending';
    amountKobo: number;
    currency: string;
    paidAt: Date | null;
    reference: string;
    customerEmail: string;
    channel?: string;
    /** Paystack's own transaction id (what the business sees on its Paystack dashboard). */
    transactionId?: string;
    /**
     * Whatever we stamped at initialize time. Carries `collectionRoute`, which
     * decides whether this money is in Bookly's balance and may credit a
     * wallet.
     */
    metadata?: Record<string, unknown> | null;
}

interface PaystackEnvelope<T> {
    status: boolean;
    message?: string;
    data?: T;
}

async function paystackRequest<T>(
    path: string,
    init: RequestInit,
    step: PaystackStep,
): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${PAYSTACK_BASE}${path}`, init);
    } catch (err) {
        throw new PaystackError(step, `network_error: ${(err as Error).message}`);
    }

    let body: PaystackEnvelope<T> | undefined;
    try {
        body = (await response.json()) as PaystackEnvelope<T>;
    } catch {
        throw new PaystackError(step, `http_${response.status}: invalid_json`);
    }

    if (!response.ok || !body || body.status === false || !body.data) {
        const msg = body?.message ?? `http_${response.status}`;
        throw new PaystackError(step, msg);
    }
    return body.data;
}

/**
 * Initialise a Paystack transaction. Returns the hosted-page URL the customer
 * needs to visit, plus the Paystack reference (which we persist on the Order
 * so the webhook can resolve back to it).
 */
export async function initializeTransaction(args: InitializeArgs): Promise<InitializeResult> {
    if (!args.secretKey) {
        throw new PaystackError('config', 'secretKey is required');
    }
    if (!Number.isInteger(args.amountKobo) || args.amountKobo <= 0) {
        throw new PaystackError('initialize', 'amountKobo must be a positive integer');
    }

    const data = await paystackRequest<{
        authorization_url: string;
        access_code: string;
        reference: string;
    }>(
        '/transaction/initialize',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: args.email,
                amount: args.amountKobo,
                currency: args.currency,
                reference: args.reference,
                callback_url: args.callbackUrl,
                metadata: args.metadata,
            }),
        },
        'initialize',
    );

    return {
        authorizationUrl: data.authorization_url,
        reference: data.reference,
        accessCode: data.access_code,
    };
}

/**
 * Re-verify a transaction directly with Paystack. Used after webhook delivery
 * as defence-in-depth: HMAC alone proves authenticity but not state, and we
 * want the authoritative amount/currency for our records.
 */
export async function verifyTransaction(
    secretKey: string,
    reference: string,
): Promise<VerifyResult> {
    if (!secretKey) {
        throw new PaystackError('config', 'secretKey is required');
    }
    if (!reference) {
        throw new PaystackError('verify', 'reference is required');
    }

    const data = await paystackRequest<{
        status: string;
        amount: number;
        currency: string;
        metadata?: Record<string, unknown> | null;
        paid_at: string | null;
        reference: string;
        customer: { email: string };
        channel?: string;
        id?: number | string;
    }>(
        `/transaction/verify/${encodeURIComponent(reference)}`,
        {
            method: 'GET',
            headers: { Authorization: `Bearer ${secretKey}` },
        },
        'verify',
    );

    const status = ((): VerifyResult['status'] => {
        switch (data.status) {
            case 'success':
            case 'failed':
            case 'abandoned':
            case 'pending':
                return data.status;
            default:
                return 'pending';
        }
    })();

    return {
        status,
        amountKobo: data.amount,
        currency: data.currency,
        metadata: data.metadata ?? null,
        paidAt: data.paid_at ? new Date(data.paid_at) : null,
        reference: data.reference,
        customerEmail: data.customer.email,
        channel: data.channel,
        transactionId: data.id != null ? String(data.id) : undefined,
    };
}

/**
 * Verify the Paystack webhook signature.
 *   header: x-paystack-signature
 *   algo:   HMAC-SHA512 of the raw request body
 *   key:    the tenant's secret_key
 *
 * Returns true only on a constant-time match. Missing header / mismatched
 * length / decode failure all return false (never throw).
 */
export function verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    secretKey: string,
): boolean {
    if (!rawBody || !signatureHeader || !secretKey) return false;

    const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
    if (signatureHeader.length !== expected.length) return false;

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signatureHeader, 'hex'),
            Buffer.from(expected, 'hex'),
        );
    } catch {
        return false;
    }
}

export interface RefundResult {
    /** Paystack's id for the refund, used as the ledger idempotency key. */
    id: string;
    status: string;
    amountKobo: number;
    currency: string;
}

/**
 * Refund a transaction, in whole or in part.
 *
 * Used when the BUSINESS cancels a paid booking. Deposits are otherwise
 * non-refundable, but a salon keeping a customer's money for work nobody is
 * going to do invites a chargeback — which costs the deposit, a dispute fee
 * and standing with Paystack. Refunding voluntarily is strictly cheaper.
 *
 * `amountKobo` omitted refunds the full transaction.
 *
 * NO IDEMPOTENCY KEY: Paystack's POST /refund takes only transaction, amount,
 * currency, customer_note and merchant_note, so there is nothing to make a
 * replay a provider-side no-op. Replay safety therefore rests on two things:
 * the provider refuses a transaction that is already fully reversed (callers
 * treat that error as success, see `isAlreadyRefundedError`) and the ledger
 * movement is keyed per entity (`refund:booking:<id>`, `refund:order:<id>`).
 * `merchantNote` is only a traceability label shown on the Paystack dashboard.
 */
export async function refundTransaction(
    secretKey: string,
    reference: string,
    amountKobo?: number,
    opts: { merchantNote?: string } = {},
): Promise<RefundResult> {
    const data = await paystackRequest<{
        id?: number | string;
        status?: string;
        amount?: number;
        currency?: string;
    }>(
        '/refund',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                transaction: reference,
                ...(amountKobo !== undefined ? { amount: amountKobo } : {}),
                ...(opts.merchantNote ? { merchant_note: opts.merchantNote.slice(0, 200) } : {}),
            }),
        },
        'refund',
    );

    return {
        id: String(data.id ?? reference),
        status: data.status ?? 'pending',
        amountKobo: data.amount ?? amountKobo ?? 0,
        currency: data.currency ?? 'GHS',
    };
}
