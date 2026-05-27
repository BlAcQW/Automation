import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSms, verifyApiKey, normalizePhoneForArkesel } from './arkesel';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('normalizePhoneForArkesel', () => {
    it('strips +, spaces, dashes', () => {
        expect(normalizePhoneForArkesel('+233 24 123 4567')).toBe('233241234567');
        expect(normalizePhoneForArkesel('233-24-123-4567')).toBe('233241234567');
        expect(normalizePhoneForArkesel('233241234567')).toBe('233241234567');
    });

    it('returns empty string when no digits', () => {
        expect(normalizePhoneForArkesel('---')).toBe('');
        expect(normalizePhoneForArkesel('')).toBe('');
    });
});

describe('sendSms', () => {
    it('POSTs to /sms/send with api-key header and recipients array', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({ status: 'success', data: [{ id: 'msg-1', recipient: '233241234567' }] }),
                { status: 200 },
            ),
        );

        const result = await sendSms({
            apiKey: 'AK_test',
            senderId: 'BookingFlow',
            to: '+233 24 123 4567',
            message: 'Hello',
        });

        expect(result.ok).toBe(true);
        expect(result.messageId).toBe('msg-1');

        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toBe('https://sms.arkesel.com/api/v2/sms/send');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['api-key']).toBe('AK_test');
        expect(headers['Content-Type']).toBe('application/json');

        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({
            sender: 'BookingFlow',
            message: 'Hello',
            recipients: ['233241234567'],
        });
    });

    it('returns ok:false on Arkesel non-success status', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({ status: 'error', message: 'Insufficient balance' }),
                { status: 200 },
            ),
        );
        const result = await sendSms({
            apiKey: 'AK_test',
            senderId: 'BookingFlow',
            to: '+233241234567',
            message: 'Hi',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Insufficient balance');
    });

    it('returns ok:false on 4xx response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), { status: 401 }),
        );
        const result = await sendSms({
            apiKey: 'bad',
            senderId: 'BookingFlow',
            to: '+233241234567',
            message: 'Hi',
        });
        expect(result.ok).toBe(false);
    });

    it('returns ok:false on network error (no throw)', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection reset'));
        const result = await sendSms({
            apiKey: 'AK_test',
            senderId: 'BookingFlow',
            to: '+233241234567',
            message: 'Hi',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('network');
    });

    it('rejects empty message / phone before calling Arkesel', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const noMsg = await sendSms({ apiKey: 'k', senderId: 's', to: '+1', message: '' });
        expect(noMsg.ok).toBe(false);
        const noPhone = await sendSms({ apiKey: 'k', senderId: 's', to: '---', message: 'hi' });
        expect(noPhone.ok).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('verifyApiKey', () => {
    it('returns ok with balance on 200 + success', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({ status: 'success', data: { sms_balance: 200 } }),
                { status: 200 },
            ),
        );
        const result = await verifyApiKey('AK_good');
        expect(result.ok).toBe(true);
        expect(result.balance).toBe(200);
    });

    it('returns ok:false on 401', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('Unauthorized', { status: 401 }),
        );
        const result = await verifyApiKey('AK_bad');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('401');
    });
});
