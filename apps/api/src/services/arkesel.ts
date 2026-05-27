/**
 * Arkesel SMS — per-tenant integration.
 *
 * Docs: https://developers.arkesel.com/  (v2 REST API)
 *   - Base: https://sms.arkesel.com/api/v2
 *   - Auth: header `api-key: <KEY>` (NOT Bearer)
 *   - Send:    POST /sms/send         { sender, message, recipients: [...] }
 *   - Balance: GET  /clients/balance-details
 *
 * Phone format: international, no `+` prefix. e.g. "233241234567".
 *
 * Never throws — returns `{ ok, error }` so the worker can decide retry.
 */

const ARKESEL_BASE = 'https://sms.arkesel.com/api/v2';

export type ArkeselStep = 'config' | 'send' | 'balance' | 'parse' | 'network';

export class ArkeselError extends Error {
    constructor(public readonly step: ArkeselStep, public readonly details: string) {
        super(`arkesel_${step}: ${details}`);
        this.name = 'ArkeselError';
    }
}

export interface SendSmsArgs {
    apiKey: string;
    senderId: string;
    to: string;
    message: string;
}

export interface SendSmsResult {
    ok: boolean;
    error?: string;
    messageId?: string;
}

export interface VerifyResult {
    ok: boolean;
    balance?: number;
    error?: string;
}

/**
 * Strip everything except digits. Arkesel rejects "+", spaces, dashes.
 *   "+233 24 123 4567" -> "233241234567"
 */
export function normalizePhoneForArkesel(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
}

export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
    if (!args.apiKey) {
        return { ok: false, error: 'arkesel_config: apiKey is required' };
    }
    if (!args.senderId) {
        return { ok: false, error: 'arkesel_config: senderId is required' };
    }
    if (!args.message) {
        return { ok: false, error: 'arkesel_send: message is empty' };
    }

    const recipient = normalizePhoneForArkesel(args.to);
    if (!recipient) {
        return { ok: false, error: 'arkesel_send: recipient phone is empty after normalization' };
    }

    let response: Response;
    try {
        response = await fetch(`${ARKESEL_BASE}/sms/send`, {
            method: 'POST',
            headers: {
                'api-key': args.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sender: args.senderId,
                message: args.message,
                recipients: [recipient],
            }),
        });
    } catch (err) {
        return { ok: false, error: `arkesel_network: ${(err as Error).message}` };
    }

    let body: { status?: string; message?: string; data?: Array<{ id?: string; recipient?: string }> };
    try {
        body = (await response.json()) as typeof body;
    } catch {
        return { ok: false, error: `arkesel_parse: invalid JSON, status=${response.status}` };
    }

    if (!response.ok || body?.status !== 'success') {
        const msg = body?.message ?? `http_${response.status}`;
        return { ok: false, error: `arkesel_send: ${msg}` };
    }

    return { ok: true, messageId: body.data?.[0]?.id };
}

/**
 * Probe the API key with /clients/balance-details. Used by /sms/connect to
 * validate credentials before persisting them.
 */
export async function verifyApiKey(apiKey: string): Promise<VerifyResult> {
    if (!apiKey) return { ok: false, error: 'arkesel_config: apiKey is required' };

    let response: Response;
    try {
        response = await fetch(`${ARKESEL_BASE}/clients/balance-details`, {
            method: 'GET',
            headers: { 'api-key': apiKey },
        });
    } catch (err) {
        return { ok: false, error: `arkesel_network: ${(err as Error).message}` };
    }

    if (response.status === 401) {
        return { ok: false, error: 'arkesel_balance: 401 (invalid api key)' };
    }
    if (!response.ok) {
        return { ok: false, error: `arkesel_balance: http_${response.status}` };
    }

    let body: { status?: string; data?: { balance?: number; sms_balance?: number } };
    try {
        body = (await response.json()) as typeof body;
    } catch {
        return { ok: false, error: 'arkesel_parse: invalid JSON' };
    }

    if (body?.status !== 'success') {
        return { ok: false, error: 'arkesel_balance: non-success response' };
    }

    const balance = body.data?.sms_balance ?? body.data?.balance;
    return { ok: true, balance: typeof balance === 'number' ? balance : undefined };
}
