import crypto from 'node:crypto';
import { config } from '../config/index.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

export type PlatformPaystackStep =
    | 'config'
    | 'create_customer'
    | 'initialize'
    | 'fetch_subscription'
    | 'disable'
    | 'verify_signature';

export class PlatformPaystackError extends Error {
    constructor(public readonly step: PlatformPaystackStep, public readonly details: string) {
        super(`paystack_platform_${step}: ${details}`);
        this.name = 'PlatformPaystackError';
    }
}

interface PaystackEnvelope<T> {
    status: boolean;
    message?: string;
    data?: T;
}

async function paystackRequest<T>(
    path: string,
    init: RequestInit,
    step: PlatformPaystackStep,
): Promise<T> {
    if (!config.platformPaystack.secretKey) {
        throw new PlatformPaystackError('config', 'BOOKINGFLOW_PAYSTACK_SECRET_KEY is not set');
    }

    let response: Response;
    try {
        response = await fetch(`${PAYSTACK_BASE}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${config.platformPaystack.secretKey}`,
                'Content-Type': 'application/json',
                ...(init.headers ?? {}),
            },
        });
    } catch (err) {
        throw new PlatformPaystackError(step, `network_error: ${(err as Error).message}`);
    }

    let body: PaystackEnvelope<T> | undefined;
    try {
        body = (await response.json()) as PaystackEnvelope<T>;
    } catch {
        throw new PlatformPaystackError(step, `http_${response.status}: invalid_json`);
    }

    if (!response.ok || !body || body.status === false || !body.data) {
        const msg = body?.message ?? `http_${response.status}`;
        throw new PlatformPaystackError(step, msg);
    }
    return body.data;
}

/**
 * Ensure a Paystack customer exists for the tenant owner. Paystack's
 * /customer endpoint is idempotent on email — returns the existing customer
 * when one is already on the account, otherwise creates a fresh one.
 */
export async function ensurePaystackCustomer(args: {
    email: string;
    phone?: string;
    metadata: Record<string, unknown>;
}): Promise<{ customerCode: string }> {
    const data = await paystackRequest<{ customer_code: string }>(
        '/customer',
        {
            method: 'POST',
            body: JSON.stringify({
                email: args.email,
                phone: args.phone,
                metadata: args.metadata,
            }),
        },
        'create_customer',
    );
    return { customerCode: data.customer_code };
}

/**
 * Initialise a subscription-bound transaction. The first charge happens
 * immediately when the customer completes Paystack's hosted-page flow;
 * Paystack then auto-charges every subsequent period.
 *
 * The `plan` field on the transaction request links the charge to a
 * Paystack Plan, which is what kicks off recurring billing.
 */
export async function initializeSubscriptionTransaction(args: {
    email: string;
    amountKobo: number;
    planCode: string;
    reference: string;
    callbackUrl?: string;
    metadata: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; reference: string; accessCode: string }> {
    if (!Number.isInteger(args.amountKobo) || args.amountKobo <= 0) {
        throw new PlatformPaystackError('initialize', 'amountKobo must be a positive integer');
    }
    const data = await paystackRequest<{
        authorization_url: string;
        access_code: string;
        reference: string;
    }>(
        '/transaction/initialize',
        {
            method: 'POST',
            body: JSON.stringify({
                email: args.email,
                amount: args.amountKobo,
                plan: args.planCode,
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
 * Disable an active subscription. Paystack stops auto-charging immediately,
 * but the customer keeps any paid period through `currentPeriodEnd` (our
 * lazy evaluator handles the downgrade once that lapses).
 *
 * Both `code` and `token` are required — the token is Paystack's
 * email_token returned at subscription creation.
 */
export async function disableSubscription(args: {
    code: string;
    token: string;
}): Promise<void> {
    if (!args.code || !args.token) {
        throw new PlatformPaystackError('disable', 'code and token are required');
    }
    await paystackRequest<unknown>(
        '/subscription/disable',
        {
            method: 'POST',
            body: JSON.stringify({ code: args.code, token: args.token }),
        },
        'disable',
    );
}

/**
 * HMAC-SHA512 verification using the PLATFORM secret. Mirrors the per-tenant
 * verifier in paystack.ts; intentionally separate so a key-rotation mistake
 * can't conflate the two channels.
 */
export function verifyPlatformWebhookSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
): boolean {
    const secret = config.platformPaystack.secretKey;
    if (!rawBody || !signatureHeader || !secret) return false;

    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
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
