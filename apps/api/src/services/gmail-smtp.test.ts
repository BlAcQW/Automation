import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock nodemailer before importing the service so the spy is in place when
// `createTransport` is called at module-evaluation / first-call time.
const sendMailMock = vi.fn();
const verifyMock = vi.fn();
const closeMock = vi.fn();

vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: sendMailMock,
            verify: verifyMock,
            close: closeMock,
        })),
    },
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('sendEmail', () => {
    it('calls nodemailer.sendMail with from header + body + closes transport', async () => {
        sendMailMock.mockResolvedValue({ messageId: '<msg-1@gmail.com>' });

        const { sendEmail } = await import('./gmail-smtp.js');
        const result = await sendEmail({
            user: 'sender@gmail.com',
            appPassword: 'abcd efgh ijkl mnop',
            fromName: 'BookingFlow',
            to: 'cust@example.com',
            subject: 'Booking confirmed',
            text: 'Hello',
            html: '<p>Hello</p>',
        });

        expect(result.ok).toBe(true);
        expect(result.messageId).toBe('<msg-1@gmail.com>');

        const sendArgs = sendMailMock.mock.calls[0][0];
        expect(sendArgs.from).toBe('BookingFlow <sender@gmail.com>');
        expect(sendArgs.to).toBe('cust@example.com');
        expect(sendArgs.subject).toBe('Booking confirmed');
        expect(sendArgs.text).toBe('Hello');
        expect(sendArgs.html).toBe('<p>Hello</p>');
        expect(closeMock).toHaveBeenCalled();
    });

    it('uses bare email as from when fromName is omitted', async () => {
        sendMailMock.mockResolvedValue({ messageId: 'mid' });
        const { sendEmail } = await import('./gmail-smtp.js');
        await sendEmail({
            user: 'a@b.com',
            appPassword: 'xxxx xxxx xxxx xxxx',
            to: 'c@d.com',
            subject: 's',
            text: 't',
        });
        expect(sendMailMock.mock.calls[0][0].from).toBe('a@b.com');
    });

    it('returns ok:false with gmail_eauth on auth failure', async () => {
        const err = Object.assign(new Error('Invalid login'), {
            code: 'EAUTH',
            response: '535-5.7.8 Username and Password not accepted.',
        });
        sendMailMock.mockRejectedValue(err);

        const { sendEmail } = await import('./gmail-smtp.js');
        const result = await sendEmail({
            user: 'a@b.com',
            appPassword: 'bad',
            to: 'c@d.com',
            subject: 's',
            text: 't',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('gmail_eauth');
    });

    it('returns ok:false with gmail_send on other errors', async () => {
        sendMailMock.mockRejectedValue(new Error('ETIMEDOUT'));
        const { sendEmail } = await import('./gmail-smtp.js');
        const result = await sendEmail({
            user: 'a@b.com',
            appPassword: 'pw',
            to: 'c@d.com',
            subject: 's',
            text: 't',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('gmail_send');
    });

    it('rejects missing user/password without calling nodemailer', async () => {
        const { sendEmail } = await import('./gmail-smtp.js');
        const result = await sendEmail({
            user: '',
            appPassword: '',
            to: 'c@d.com',
            subject: 's',
            text: 't',
        });
        expect(result.ok).toBe(false);
        expect(sendMailMock).not.toHaveBeenCalled();
    });
});

describe('verifyGmailCreds', () => {
    it('returns ok on transporter.verify() success', async () => {
        verifyMock.mockResolvedValue(true);
        const { verifyGmailCreds } = await import('./gmail-smtp.js');
        const result = await verifyGmailCreds({ user: 'a@b.com', appPassword: 'pw' });
        expect(result.ok).toBe(true);
    });

    it('returns ok:false with gmail_eauth on EAUTH', async () => {
        const err = Object.assign(new Error('Auth failed'), { code: 'EAUTH' });
        verifyMock.mockRejectedValue(err);
        const { verifyGmailCreds } = await import('./gmail-smtp.js');
        const result = await verifyGmailCreds({ user: 'a@b.com', appPassword: 'bad' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('gmail_eauth');
    });
});

// ---------------------------------------------------------------------------
// Phase 5a — resolveGmailCreds (tenant-first, platform fallback)
// ---------------------------------------------------------------------------

describe('resolveGmailCreds', () => {
    const ORIGINAL_USER = process.env.BOOKINGFLOW_GMAIL_USER;
    const ORIGINAL_PASS = process.env.BOOKINGFLOW_GMAIL_APP_PASSWORD;
    const ORIGINAL_FROM = process.env.BOOKINGFLOW_GMAIL_FROM_NAME;

    afterEach(() => {
        // Restore so other tests aren't poisoned by env mutations.
        if (ORIGINAL_USER !== undefined) process.env.BOOKINGFLOW_GMAIL_USER = ORIGINAL_USER;
        else delete process.env.BOOKINGFLOW_GMAIL_USER;
        if (ORIGINAL_PASS !== undefined) process.env.BOOKINGFLOW_GMAIL_APP_PASSWORD = ORIGINAL_PASS;
        else delete process.env.BOOKINGFLOW_GMAIL_APP_PASSWORD;
        if (ORIGINAL_FROM !== undefined) process.env.BOOKINGFLOW_GMAIL_FROM_NAME = ORIGINAL_FROM;
        else delete process.env.BOOKINGFLOW_GMAIL_FROM_NAME;
    });

    it('uses tenant credentials when present (source: tenant)', async () => {
        const { encrypt } = await import('./crypto.js');
        const { resolveGmailCreds } = await import('./gmail-smtp.js');

        const creds = resolveGmailCreds({
            tenantGmailUser: 'tenant@gmail.com',
            tenantGmailAppPasswordEncrypted: encrypt('tenant-pass-1234'),
            tenantGmailFromName: 'TenantBrand',
        });

        expect(creds).not.toBeNull();
        expect(creds!.source).toBe('tenant');
        expect(creds!.user).toBe('tenant@gmail.com');
        expect(creds!.appPassword).toBe('tenant-pass-1234');
        expect(creds!.fromName).toBe('TenantBrand');
    });

    it('falls back to platform env when tenant Gmail is missing (source: platform)', async () => {
        // Re-import the config + service module so the freshly-set env vars
        // are picked up via the platform config block.
        process.env.BOOKINGFLOW_GMAIL_USER = 'platform@gmail.com';
        process.env.BOOKINGFLOW_GMAIL_APP_PASSWORD = 'platform-pass-5678';
        process.env.BOOKINGFLOW_GMAIL_FROM_NAME = 'BookingFlow';
        vi.resetModules();

        const { resolveGmailCreds } = await import('./gmail-smtp.js');
        const creds = resolveGmailCreds({
            tenantGmailUser: null,
            tenantGmailAppPasswordEncrypted: null,
            tenantGmailFromName: null,
        });

        expect(creds).not.toBeNull();
        expect(creds!.source).toBe('platform');
        expect(creds!.user).toBe('platform@gmail.com');
        expect(creds!.appPassword).toBe('platform-pass-5678');
        expect(creds!.fromName).toBe('BookingFlow');
    });

    it('returns null when neither tenant nor platform Gmail is configured', async () => {
        delete process.env.BOOKINGFLOW_GMAIL_USER;
        delete process.env.BOOKINGFLOW_GMAIL_APP_PASSWORD;
        vi.resetModules();

        const { resolveGmailCreds } = await import('./gmail-smtp.js');
        const creds = resolveGmailCreds({
            tenantGmailUser: null,
            tenantGmailAppPasswordEncrypted: null,
            tenantGmailFromName: null,
        });

        expect(creds).toBeNull();
    });
});
