/**
 * Payaza (payaza.africa) client: the second per-organisation payment provider,
 * next to Paystack (services/paystack.ts). Used only for fulfillment-kind
 * payment links (TURBO rides, flow payment steps); bookings and orders stay on
 * Paystack.
 *
 * WHAT PAYAZA LOOKS LIKE (docs.payaza.africa, as of 2026-10):
 *  - REST auth: `Authorization: Payaza <base64(PUBLIC key)>`. One base URL for
 *    both environments (`/live` is a fixed path segment); test vs live is the
 *    `X-TenantID: test|live` header plus the key generated in that mode.
 *  - Hosted payment page: a redirect URL WE build (no API call), carrying the
 *    raw public key, the amount in MAJOR units and our reference. The amount is
 *    visible to (and editable by) the customer, so it is never trusted: the
 *    status query below is what a fulfiller sees, and fulfillers check it
 *    against their own row.
 *  - Status query by merchant reference: Initialized | Completed | Failed.
 *  - Webhooks: `x-payaza-signature` = base64(HMAC-SHA512(raw body, raw SECRET key)).
 *    The secret key is used for nothing else.
 */
import crypto from 'node:crypto';
import type { VerifyResult } from './paystack.js';

export const PAYAZA_API_BASE = 'https://api.payaza.africa/live';
export const PAYAZA_CHECKOUT_BASE = 'https://payment.payaza.africa/';
const STATUS_QUERY_PATH = '/merchant-collection/transfer_notification_controller/merchant/transaction-query';

/**
 * ISO 3166 alpha-3, as in the Payment Page docs example (`country_code=NGA`).
 * The docs are inconsistent across products (the MoMo API uses alpha-2), so it
 * is one constant to change if Payaza's checkout wants `GH`.
 */
export const PAYAZA_COUNTRY_CODE = 'GHA';

export type PayazaMode = 'TEST' | 'LIVE';
export type PayazaStep = 'config' | 'link' | 'query' | 'probe';

export class PayazaError extends Error {
    constructor(public readonly step: PayazaStep, public readonly details: string) {
        super(`payaza_${step}: ${details}`);
        this.name = 'PayazaError';
    }
}

export function payazaAuthHeaders(publicKey: string, mode: PayazaMode): { Authorization: string; 'X-TenantID': string } {
    return {
        Authorization: `Payaza ${Buffer.from(publicKey, 'utf8').toString('base64')}`,
        'X-TenantID': mode === 'LIVE' ? 'live' : 'test',
    };
}

// ------------------------------------------------------------ payment page

export interface PaymentPageArgs {
    /** The RAW public key (the page takes it unencoded). */
    publicKey: string;
    mode: PayazaMode;
    /** Integer minor units (pesewas); rendered as major units on the page. */
    amountMinor: number;
    currency: string;
    email: string;
    firstName?: string;
    lastName?: string;
    /** 233XXXXXXXXX or empty. */
    phone?: string;
    /** Our reference; comes back as merchant_reference / merchant_transaction_reference. */
    reference: string;
    /** Shown on the Payaza dashboard. Informational only: never read back for routing. */
    additionalDetails?: Record<string, unknown>;
    /** Where the customer lands after paying. Payaza requires it to be the LAST parameter. */
    redirectUrl?: string;
}

function minorToMajorString(minor: number): string {
    const whole = Math.floor(minor / 100);
    const cents = minor % 100;
    return `${whole}.${String(cents).padStart(2, '0')}`;
}

export function buildPaymentPageUrl(args: PaymentPageArgs): string {
    if (!args.publicKey) throw new PayazaError('config', 'publicKey is required');
    if (!args.reference) throw new PayazaError('link', 'reference is required');
    if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0) {
        throw new PayazaError('link', 'amountMinor must be a positive integer');
    }

    const params: Array<[string, string]> = [
        ['merchant_key', args.publicKey],
        // Lowercase, exactly as the Payment Page docs example (`connection_mode=live`).
        ['connection_mode', args.mode === 'LIVE' ? 'live' : 'test'],
        ['checkout_amount', minorToMajorString(args.amountMinor)],
        ['currency_code', args.currency.toUpperCase()],
        ['country_code', PAYAZA_COUNTRY_CODE],
        ['email_address', args.email],
        ['first_name', args.firstName ?? ''],
        ['last_name', args.lastName ?? ''],
        ['phone_number', args.phone ?? ''],
        ['transaction_reference', args.reference],
    ];
    if (args.additionalDetails) params.push(['additional_details', JSON.stringify(args.additionalDetails)]);
    // Must stay last (Payaza docs: "This must be the last parameter in the request if included").
    if (args.redirectUrl) params.push(['redirect_url', args.redirectUrl]);

    return `${PAYAZA_CHECKOUT_BASE}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** +233 24 123 4567 / 0241234567 / 233241234567 -> 233241234567; anything else -> ''. */
export function ghanaPhoneForPayaza(raw: string | null | undefined): string {
    const digits = (raw ?? '').replace(/[^0-9]/g, '');
    if (/^233[0-9]{9}$/.test(digits)) return digits;
    if (/^0[0-9]{9}$/.test(digits)) return `233${digits.slice(1)}`;
    return '';
}

// ------------------------------------------------------------ webhook signature

const BASE64_SHA512 = /^[A-Za-z0-9+/]{86}==$/;
const HEX_SHA512 = /^[0-9a-fA-F]{128}$/;

/**
 * x-payaza-signature = base64(HMAC-SHA512(rawBody, secretKey as utf8)).
 *
 * Also accepts the same digest hex-encoded: the docs sample is base64, but a
 * provider-side encoding change would otherwise reject every genuine payment.
 * Either way the comparison is the full 64-byte digest, constant time. Never
 * throws; missing or malformed input is simply false.
 */
export function verifyPayazaSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    secretKey: string,
): boolean {
    if (!rawBody || !signatureHeader || !secretKey) return false;
    const header = signatureHeader.trim();
    let received: Buffer;
    if (BASE64_SHA512.test(header)) received = Buffer.from(header, 'base64');
    else if (HEX_SHA512.test(header)) received = Buffer.from(header, 'hex');
    else return false;

    const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest();
    if (received.length !== expected.length) return false;
    try {
        return crypto.timingSafeEqual(received, expected);
    } catch {
        return false;
    }
}

// ------------------------------------------------------------ status query

interface StatusQueryData {
    transaction_reference?: string | null;
    amount_received?: number | string | null;
    transaction_status?: string | null;
    currency?: string | null;
    merchant_transaction_reference?: string | null;
    transaction_type?: string | null;
    current_status_date?: string | null;
}

interface StatusQueryEnvelope {
    message?: string;
    success?: boolean;
    status?: boolean;
    data?: StatusQueryData | null;
}

/** 20.28, "20.28", "1,020.28" -> 2028 / 102028. NaN for anything unreadable or negative. */
export function payazaMajorToMinor(value: unknown): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : NaN;
    if (typeof value === 'string' && value.trim() === '') return NaN;
    if (!Number.isFinite(n) || n < 0) return NaN;
    // toFixed first: 1020.285 * 100 is 102028.49999999999 in binary floating point.
    return Math.round(Number((n * 100).toFixed(6)));
}

function mapStatus(raw: string | null | undefined): VerifyResult['status'] {
    switch ((raw ?? '').trim().toLowerCase()) {
        case 'completed': return 'success';
        case 'failed': return 'failed';
        default: return 'pending'; // Initialized, or anything Payaza adds later
    }
}

/**
 * Payaza's transaction_type (GH_MOBILEMONEY, CARD, ...) as the readable channel
 * the console shows next to Paystack's (mobile_money, card, bank_transfer).
 * Unknown types are lowercased; empty is undefined.
 */
export function payazaChannel(raw: string | null | undefined): string | undefined {
    const t = (raw ?? '').trim().toUpperCase();
    if (!t) return undefined;
    if (/MOBILE_?MONEY|MOMO/.test(t)) return 'mobile_money';
    if (/CARD/.test(t)) return 'card';
    if (/BANK|TRANSFER/.test(t)) return 'bank_transfer';
    return t.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
}

function isAuthFailure(status: number, body: StatusQueryEnvelope | undefined): boolean {
    return status === 401 || status === 403 || /authentication failed/i.test(body?.message ?? '');
}

async function statusQuery(publicKey: string, mode: PayazaMode, reference: string, step: PayazaStep): Promise<{ status: number; body: StatusQueryEnvelope | undefined }> {
    let response: Response;
    try {
        response = await fetch(`${PAYAZA_API_BASE}${STATUS_QUERY_PATH}?merchant_reference=${encodeURIComponent(reference)}`, {
            method: 'GET',
            headers: { ...payazaAuthHeaders(publicKey, mode), Accept: 'application/json' },
        });
    } catch (err) {
        throw new PayazaError(step, `network_error: ${(err as Error).message}`);
    }
    let body: StatusQueryEnvelope | undefined;
    try {
        body = (await response.json()) as StatusQueryEnvelope;
    } catch {
        body = undefined;
    }
    return { status: response.status, body };
}

/**
 * The status of OUR reference, as Payaza records it, in the VerifyResult shape
 * the fulfillment dispatcher expects. This is the source of truth for a
 * webhook: the webhook only says "look now".
 *
 * `metadata` is always null: Payaza does not echo additional_details here. The
 * webhook supplies trusted metadata derived from our own reference instead
 * (payment-fulfillers.ts, `trustedMetadata`).
 */
export async function queryTransaction(publicKey: string, mode: PayazaMode, reference: string): Promise<VerifyResult> {
    if (!publicKey) throw new PayazaError('config', 'publicKey is required');
    if (!reference) throw new PayazaError('query', 'reference is required');

    const { status, body } = await statusQuery(publicKey, mode, reference, 'query');
    if (!body) throw new PayazaError('query', `http_${status}: invalid_json`);
    if (isAuthFailure(status, body)) throw new PayazaError('query', body.message ?? 'Authentication failed');
    if (status < 200 || status >= 300 || body.success === false || body.status === false || !body.data) {
        throw new PayazaError('query', body.message ?? `http_${status}`);
    }

    const data = body.data;
    const echoed = data.merchant_transaction_reference;
    if (echoed && echoed !== reference) throw new PayazaError('query', 'reference_mismatch');

    const mapped = mapStatus(data.transaction_status);
    const amountMinor = payazaMajorToMinor(data.amount_received);
    if (mapped === 'success' && !Number.isSafeInteger(amountMinor)) {
        throw new PayazaError('query', 'amount_invalid');
    }
    const statusDate = data.current_status_date ? new Date(data.current_status_date.replace(' ', 'T')) : null;

    return {
        status: mapped,
        amountKobo: Number.isSafeInteger(amountMinor) ? amountMinor : 0,
        currency: String(data.currency ?? '').toUpperCase(),
        paidAt: mapped === 'success' && statusDate && !Number.isNaN(statusDate.getTime()) ? statusDate : null,
        reference,
        customerEmail: '',
        channel: payazaChannel(data.transaction_type),
        transactionId: data.transaction_reference ?? undefined,
        metadata: null,
    };
}

export type ProbeOutcome = 'valid' | 'invalid' | 'unknown';

/**
 * Cheap authenticated call to check a public key + mode before storing them:
 * a status query for a random reference that cannot exist.
 *
 * SIGNAL RELIED ON: Payaza answers a bad key, a key from the other mode, or a
 * malformed Authorization header with `{"message":"Authentication failed"}`
 * (documented in guides/authentication + guides/errors), so that message (or
 * HTTP 401/403) means 'invalid'. Any other 2xx/4xx answer means the key was
 * accepted and the lookup simply found nothing: 'valid'. Network errors and
 * 5xx are 'unknown' (the caller decides; connect treats it as non-fatal, like
 * the Paystack probe).
 *
 * The SECRET key cannot be probed: Payaza only uses it to sign webhooks.
 */
export async function probeKeys(publicKey: string, mode: PayazaMode): Promise<ProbeOutcome> {
    const reference = `bf_probe_${crypto.randomBytes(8).toString('hex')}`;
    let result: { status: number; body: StatusQueryEnvelope | undefined };
    try {
        result = await statusQuery(publicKey, mode, reference, 'probe');
    } catch {
        return 'unknown';
    }
    if (isAuthFailure(result.status, result.body)) return 'invalid';
    if (result.status >= 500) return 'unknown';
    return 'valid';
}
