import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({ config: { platformSms: { apiKey: '', senderId: '' }, platformGmail: {} } }));
const m = vi.hoisted(() => ({
    deliverReply: vi.fn(), tryReserveOutbound: vi.fn(), rollbackOutboundReservation: vi.fn(), getPlatformSmsCount: vi.fn(),
    incrementPlatformSmsUsage: vi.fn(), sendSms: vi.fn(), sendEmail: vi.fn(), resolveGmailCreds: vi.fn(), isOutboundPaused: vi.fn(),
}));
vi.mock('../../routes/whatsapp/reply-outbox.js', () => ({
    deliverReply: m.deliverReply,
    ReplySendError: class ReplySendError extends Error {},
}));
vi.mock('../tenant-channel-creds.js', () => ({ tenantChannelCreds: () => ({ token: 'x' }) }));
vi.mock('../usage.js', () => ({
    tryReserveOutbound: m.tryReserveOutbound, rollbackOutboundReservation: m.rollbackOutboundReservation,
    getPlatformSmsCount: m.getPlatformSmsCount, incrementPlatformSmsUsage: m.incrementPlatformSmsUsage,
}));
vi.mock('../arkesel.js', () => ({ sendSms: m.sendSms }));
vi.mock('../gmail-smtp.js', () => ({ sendEmail: m.sendEmail, resolveGmailCreds: m.resolveGmailCreds }));
vi.mock('../platform-switches.js', () => ({ isOutboundPaused: m.isOutboundPaused }));
vi.mock('../crypto.js', () => ({ decrypt: (v: string) => `plain:${v}` }));

import { notifyRideCustomer, smsDriver, windowOpen } from './notify.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let conv: any;
const tenant = { id: 't1', arkeselApiKey: 'enc', arkeselSenderId: 'TURBO', gmailUser: null, gmailAppPassword: null, gmailFromName: null };
const prisma: any = {
    tenant: { findUnique: vi.fn(async () => tenant) },
    customer: { findFirst: vi.fn(async () => ({ id: 'c1', phone: '+233241234567', email: 'ama@example.com' })) },
    conversation: { findFirst: vi.fn(async () => conv) },
};
const args = { tenantId: 't1', customerId: 'c1', conversationId: 'conv1', text: 'hello', kind: 'ride.test' };

beforeEach(() => {
    vi.clearAllMocks();
    conv = { id: 'conv1', externalId: '233241234567', lastInboundAt: new Date(), channel: 'WHATSAPP' };
    m.tryReserveOutbound.mockResolvedValue({ ok: true });
    m.sendSms.mockResolvedValue({ ok: true });
    m.sendEmail.mockResolvedValue({ ok: true });
    m.isOutboundPaused.mockResolvedValue({ paused: false });
});

describe('notifyRideCustomer', () => {
    it('WhatsApp first, inside the 24h window, through the reply outbox', async () => {
        m.deliverReply.mockResolvedValue('sent');
        expect(await notifyRideCustomer({ prisma, log }, args)).toBe('whatsapp');
        expect(m.deliverReply).toHaveBeenCalledWith(expect.anything(), tenant, expect.objectContaining({ conversationId: 'conv1', recipientId: '233241234567', text: 'hello', metadata: expect.objectContaining({ source: 'rides', kind: 'ride.test' }) }));
        expect(m.sendSms).not.toHaveBeenCalled();
    });

    it('outside the window: SMS on the tenant\'s own Arkesel', async () => {
        conv.lastInboundAt = new Date(Date.now() - 25 * 3600_000);
        expect(await notifyRideCustomer({ prisma, log }, args)).toBe('sms');
        expect(m.deliverReply).not.toHaveBeenCalled();
        expect(m.sendSms).toHaveBeenCalledWith({ apiKey: 'plain:enc', senderId: 'TURBO', to: '+233241234567', message: 'hello' });
    });

    it('WhatsApp failure falls back to SMS, then email', async () => {
        m.deliverReply.mockRejectedValue(new Error('meta 500'));
        m.sendSms.mockResolvedValue({ ok: false });
        m.resolveGmailCreds.mockReturnValue({ user: 'turbo@gmail.com', appPassword: 'p', source: 'tenant' });
        expect(await notifyRideCustomer({ prisma, log }, { ...args, emailSubject: 'Hi' })).toBe('email');
        expect(m.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ama@example.com', subject: 'Hi', text: 'hello' }));
    });

    it('respects the emergency pause: nothing on any channel', async () => {
        m.deliverReply.mockResolvedValue('suppressed');
        m.isOutboundPaused.mockResolvedValue({ paused: true });
        expect(await notifyRideCustomer({ prisma, log }, args)).toBe('paused');
        expect(m.sendSms).not.toHaveBeenCalled();
        conv.lastInboundAt = null;
        m.tryReserveOutbound.mockResolvedValue({ ok: false, reason: 'paused' });
        expect(await notifyRideCustomer({ prisma, log }, args)).toBe('paused');
        expect(m.sendSms).not.toHaveBeenCalled();
    });

    it('every channel failing releases the quota reservation; it never throws', async () => {
        conv = null;
        m.sendSms.mockResolvedValue({ ok: false });
        m.resolveGmailCreds.mockReturnValue(null);
        expect(await notifyRideCustomer({ prisma, log }, args)).toBe('failed');
        expect(m.rollbackOutboundReservation).toHaveBeenCalled();
        prisma.tenant.findUnique.mockRejectedValueOnce(new Error('db down'));
        expect(await notifyRideCustomer({ prisma, log }, args)).toBe('failed');
    });
});

describe('smsDriver / windowOpen', () => {
    it('texts the driver and gives the quota back when it fails', async () => {
        expect(await smsDriver({ prisma, log }, { tenantId: 't1', phone: '+233200000000', text: 'pick up' })).toBe(true);
        m.sendSms.mockResolvedValue({ ok: false });
        expect(await smsDriver({ prisma, log }, { tenantId: 't1', phone: '+233200000000', text: 'pick up' })).toBe(false);
        expect(m.rollbackOutboundReservation).toHaveBeenCalled();
    });
    it('24h window', () => {
        expect(windowOpen(new Date())).toBe(true);
        expect(windowOpen(new Date(Date.now() - 25 * 3600_000))).toBe(false);
        expect(windowOpen(null)).toBe(false);
    });
});
