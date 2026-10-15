import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    PAYAZA_API_BASE,
    PayazaError,
    buildPaymentPageUrl,
    ghanaPhoneForPayaza,
    payazaAuthHeaders,
    probeKeys,
    queryTransaction,
    verifyPayazaSignature,
} from './payaza.js';

const PUBLIC_KEY = 'PZ78-PKTEST-8D51A540-4A36-4901-A314-43C9AB859068';
const SECRET_KEY = 'PZ78-SKTEST-11111111-2222-3333-4444-555555555555';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('payazaAuthHeaders', () => {
    it('uses the Payaza prefix with the base64 of the PUBLIC key, and the tenant header per mode', () => {
        expect(payazaAuthHeaders(PUBLIC_KEY, 'TEST')).toEqual({
            Authorization: `Payaza ${Buffer.from(PUBLIC_KEY).toString('base64')}`,
            'X-TenantID': 'test',
        });
        expect(payazaAuthHeaders(PUBLIC_KEY, 'LIVE')['X-TenantID']).toBe('live');
    });
});

describe('buildPaymentPageUrl', () => {
    const base = {
        publicKey: PUBLIC_KEY, mode: 'LIVE' as const, amountMinor: 96000, currency: 'GHS',
        email: '233241234567@customer.bookingflow.app', phone: '233241234567',
        reference: 'bf_f_ride_package_pass1_1700000000000',
        additionalDetails: { tenantId: 't1', fulfillmentKind: 'ride_package', entityId: 'pass1' },
        redirectUrl: 'https://wa.me/233200000000',
    };

    it('builds the hosted payment page URL with major-unit amount and Ghana defaults', () => {
        const url = new URL(buildPaymentPageUrl(base));
        expect(`${url.origin}${url.pathname}`).toBe('https://payment.payaza.africa/');
        const p = url.searchParams;
        expect(p.get('merchant_key')).toBe(PUBLIC_KEY); // raw key, not base64
        expect(p.get('connection_mode')).toBe('Live');
        expect(p.get('checkout_amount')).toBe('960.00');
        expect(p.get('currency_code')).toBe('GHS');
        expect(p.get('country_code')).toBe('GHA');
        expect(p.get('email_address')).toBe('233241234567@customer.bookingflow.app');
        expect(p.get('phone_number')).toBe('233241234567');
        expect(p.get('transaction_reference')).toBe(base.reference);
        expect(JSON.parse(p.get('additional_details')!)).toEqual(base.additionalDetails);
        expect(p.get('redirect_url')).toBe('https://wa.me/233200000000');
    });

    it('puts redirect_url LAST and percent-encodes every value', () => {
        const raw = buildPaymentPageUrl({ ...base, redirectUrl: 'https://wa.me/233200000000?text=hi there&x=1' });
        const query = raw.split('?').slice(1).join('?');
        const keys = query.split('&').map((kv) => kv.split('=')[0]);
        expect(keys[keys.length - 1]).toBe('redirect_url');
        expect(raw.endsWith(`redirect_url=${encodeURIComponent('https://wa.me/233200000000?text=hi there&x=1')}`)).toBe(true);
        // The JSON is encoded, not left raw (no bare quotes or braces in the URL).
        expect(raw).not.toMatch(/[{}"]/);
    });

    it('uses Test connection mode for TEST keys', () => {
        expect(new URL(buildPaymentPageUrl({ ...base, mode: 'TEST' })).searchParams.get('connection_mode')).toBe('Test');
    });

    it('omits redirect_url when there is none', () => {
        const raw = buildPaymentPageUrl({ ...base, redirectUrl: undefined });
        expect(raw).not.toContain('redirect_url');
    });

    it('formats amounts without float drift', () => {
        expect(new URL(buildPaymentPageUrl({ ...base, amountMinor: 1 })).searchParams.get('checkout_amount')).toBe('0.01');
        expect(new URL(buildPaymentPageUrl({ ...base, amountMinor: 2510 })).searchParams.get('checkout_amount')).toBe('25.10');
    });

    it('refuses a non-positive or fractional minor amount, and a missing key or reference', () => {
        expect(() => buildPaymentPageUrl({ ...base, amountMinor: 0 })).toThrow(PayazaError);
        expect(() => buildPaymentPageUrl({ ...base, amountMinor: 10.5 })).toThrow(PayazaError);
        expect(() => buildPaymentPageUrl({ ...base, publicKey: '' })).toThrow(PayazaError);
        expect(() => buildPaymentPageUrl({ ...base, reference: '' })).toThrow(PayazaError);
    });
});

describe('ghanaPhoneForPayaza', () => {
    it('normalises Ghana numbers to the 12-digit 233 form', () => {
        expect(ghanaPhoneForPayaza('+233 24 123 4567')).toBe('233241234567');
        expect(ghanaPhoneForPayaza('0241234567')).toBe('233241234567');
        expect(ghanaPhoneForPayaza('233241234567')).toBe('233241234567');
    });
    it('returns empty for anything else', () => {
        expect(ghanaPhoneForPayaza('')).toBe('');
        expect(ghanaPhoneForPayaza(null)).toBe('');
        expect(ghanaPhoneForPayaza('+2348012345678')).toBe('');
        expect(ghanaPhoneForPayaza('12345')).toBe('');
    });
});

describe('verifyPayazaSignature', () => {
    const body = Buffer.from(JSON.stringify({ merchant_reference: 'r1', status: 'Completed' }));
    const good = crypto.createHmac('sha512', SECRET_KEY).update(body).digest('base64');

    it('accepts base64(HMAC-SHA512(rawBody, raw secret key))', () => {
        expect(verifyPayazaSignature(body, good, SECRET_KEY)).toBe(true);
    });

    it('also accepts the same digest hex-encoded (defensive; the docs sample is base64)', () => {
        const hex = crypto.createHmac('sha512', SECRET_KEY).update(body).digest('hex');
        expect(verifyPayazaSignature(body, hex, SECRET_KEY)).toBe(true);
    });

    it('rejects a wrong key, a tampered body, and the base64 of the key instead of the raw key', () => {
        expect(verifyPayazaSignature(body, good, 'other')).toBe(false);
        expect(verifyPayazaSignature(Buffer.from(body.toString().replace('r1', 'r2')), good, SECRET_KEY)).toBe(false);
        const b64Key = crypto.createHmac('sha512', Buffer.from(SECRET_KEY).toString('base64')).update(body).digest('base64');
        expect(verifyPayazaSignature(body, b64Key, SECRET_KEY)).toBe(false);
    });

    it('never throws on missing or odd-length input', () => {
        expect(verifyPayazaSignature(undefined, good, SECRET_KEY)).toBe(false);
        expect(verifyPayazaSignature(body, undefined, SECRET_KEY)).toBe(false);
        expect(verifyPayazaSignature(body, good, '')).toBe(false);
        expect(verifyPayazaSignature(body, 'abc', SECRET_KEY)).toBe(false);
        expect(verifyPayazaSignature(body, good.slice(0, -4), SECRET_KEY)).toBe(false);
        expect(verifyPayazaSignature(body, `${good}AAAA`, SECRET_KEY)).toBe(false);
        expect(verifyPayazaSignature(body, '!'.repeat(88), SECRET_KEY)).toBe(false);
    });
});

describe('queryTransaction', () => {
    const completed = {
        message: 'Transaction data found',
        success: true,
        data: {
            transaction_reference: 'PZ-TX-1', amount_received: 960, transaction_fee: 5.5, transaction_status: 'Completed',
            currency: 'GHS', merchant_transaction_reference: 'bf_ref', transaction_type: 'GH_MOBILEMONEY',
            current_status_date: '2026-10-15 09:49:09.254',
        },
    };

    it('calls the merchant-reference status query with the auth and tenant headers', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(completed));
        await queryTransaction(PUBLIC_KEY, 'LIVE', 'bf_ref');
        const [url, init] = spy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${PAYAZA_API_BASE}/merchant-collection/transfer_notification_controller/merchant/transaction-query?merchant_reference=bf_ref`);
        expect(init.method).toBe('GET');
        expect(init.headers).toEqual(expect.objectContaining({
            Authorization: `Payaza ${Buffer.from(PUBLIC_KEY).toString('base64')}`,
            'X-TenantID': 'live',
        }));
    });

    it('maps Completed to success with minor units and the Payaza reference as transaction id', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(completed));
        const v = await queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref');
        expect(v).toMatchObject({
            status: 'success', amountKobo: 96000, currency: 'GHS', reference: 'bf_ref',
            channel: 'GH_MOBILEMONEY', transactionId: 'PZ-TX-1', metadata: null,
        });
        expect(v.paidAt).toBeInstanceOf(Date);
    });

    it('parses string amounts defensively and rounds to the pesewa', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...completed, data: { ...completed.data, amount_received: '1,020.285' } }));
        expect((await queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).amountKobo).toBe(102029);
    });

    it('maps Initialized to pending and Failed to failed; unknown statuses are pending', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        spy.mockResolvedValueOnce(jsonResponse({ ...completed, data: { ...completed.data, transaction_status: 'Initialized' } }));
        expect((await queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).status).toBe('pending');
        spy.mockResolvedValueOnce(jsonResponse({ ...completed, data: { ...completed.data, transaction_status: 'Failed' } }));
        expect((await queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).status).toBe('failed');
        spy.mockResolvedValueOnce(jsonResponse({ ...completed, data: { ...completed.data, transaction_status: 'Weird' } }));
        expect((await queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).status).toBe('pending');
    });

    it('refuses a Completed answer whose amount is unreadable', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...completed, data: { ...completed.data, amount_received: 'lots' } }));
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).rejects.toThrow(PayazaError);
    });

    it('refuses an answer about a different merchant reference', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...completed, data: { ...completed.data, merchant_transaction_reference: 'other' } }));
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).rejects.toThrow(/reference_mismatch/);
    });

    it('throws a typed error on auth failure, HTTP errors, bad JSON and network failure', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        spy.mockResolvedValueOnce(jsonResponse({ message: 'Authentication failed', status: false, retry_count: 0 }, 401));
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).rejects.toThrow(/Authentication failed/);
        spy.mockResolvedValueOnce(jsonResponse({ message: 'Transaction not found', success: false }));
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).rejects.toThrow(PayazaError);
        spy.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).rejects.toThrow(/http_502/);
        spy.mockRejectedValueOnce(new Error('ECONNRESET'));
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', 'bf_ref')).rejects.toThrow(/network_error/);
    });

    it('refuses to call without a key or reference', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        await expect(queryTransaction('', 'TEST', 'bf_ref')).rejects.toThrow(PayazaError);
        await expect(queryTransaction(PUBLIC_KEY, 'TEST', '')).rejects.toThrow(PayazaError);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('probeKeys', () => {
    it('is invalid when Payaza answers "Authentication failed" (any HTTP status) or 401/403', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        spy.mockResolvedValueOnce(jsonResponse({ message: 'Authentication failed', status: false }, 200));
        expect(await probeKeys(PUBLIC_KEY, 'LIVE')).toBe('invalid');
        spy.mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401));
        expect(await probeKeys(PUBLIC_KEY, 'LIVE')).toBe('invalid');
        spy.mockResolvedValueOnce(jsonResponse({}, 403));
        expect(await probeKeys(PUBLIC_KEY, 'LIVE')).toBe('invalid');
    });

    it('is valid when an authenticated lookup of an unknown reference comes back not-found', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Transaction not found', success: false }, 404));
        expect(await probeKeys(PUBLIC_KEY, 'TEST')).toBe('valid');
        const [url, init] = spy.mock.calls[0] as [string, RequestInit];
        expect(url).toMatch(/merchant_reference=bf_probe_[a-f0-9]+$/);
        expect((init.headers as Record<string, string>)['X-TenantID']).toBe('test');
    });

    it('is unknown when Payaza cannot be reached or answers 5xx', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        spy.mockRejectedValueOnce(new Error('ETIMEDOUT'));
        expect(await probeKeys(PUBLIC_KEY, 'TEST')).toBe('unknown');
        spy.mockResolvedValueOnce(new Response('oops', { status: 503 }));
        expect(await probeKeys(PUBLIC_KEY, 'TEST')).toBe('unknown');
    });
});
