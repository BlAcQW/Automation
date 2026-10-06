/**
 * Outbound pause vs the notification workers. A pause is not quota exhaustion:
 * no "quota exhausted / upgrade" alert, the job is NOT dropped (it is delayed
 * and re-checked), and nothing is sent or counted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelayedError } from 'bullmq';

const db = vi.hoisted(() => ({
    tenant: { findUnique: vi.fn() },
    messageTemplate: { findUnique: vi.fn() },
    notification: { create: vi.fn(async () => ({})) },
    booking: { findFirst: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
}));
vi.mock('@prisma/client', async (orig) => ({
    ...(await orig<typeof import('@prisma/client')>()),
    PrismaClient: class { constructor() { return db as any; } },
}));

const tryReserveOutbound = vi.fn();
const rollbackOutboundReservation = vi.fn(async () => undefined);
vi.mock('./usage.js', () => ({
    tryReserveOutbound: (...a: unknown[]) => tryReserveOutbound(...a),
    rollbackOutboundReservation: (...a: unknown[]) => (rollbackOutboundReservation as any)(...a),
    incrementPlatformSmsUsage: vi.fn(),
    getPlatformSmsCount: vi.fn(async () => 0),
}));
vi.mock('./whatsapp-credentials.js', () => ({ getWhatsappCredentials: async () => ({ accessToken: 'tok', phoneNumberId: 'ph' }) }));
const sendTemplateMessage = vi.fn(async () => ({ ok: true }));
vi.mock('./whatsapp-templates.js', () => ({ sendTemplateMessage: (...a: unknown[]) => (sendTemplateMessage as any)(...a) }));
const raiseAlert = vi.fn(async () => undefined);
vi.mock('./alerts.js', () => ({ raiseAlert: (...a: unknown[]) => (raiseAlert as any)(...a) }));
const sendSms = vi.fn();
vi.mock('./arkesel.js', () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));

import { processNotification, processReminder } from './notification-worker.js';
import { PAUSE_MAX_TOTAL_MS, PAUSE_RETRY_DELAY_MS } from './pause-defer.js';

function job(data: Record<string, unknown>) {
    const j: any = {
        id: 'j1', data,
        updateData: vi.fn(async (d: any) => { j.data = d; }),
        moveToDelayed: vi.fn(async () => undefined),
    };
    return j;
}
const notif = { purpose: 'ORDER_CONFIRMATION', tenantId: 't1', customerPhone: '+233241234567', variables: ['ORD-1', '10.00'] };
const reminder = { purpose: 'BOOKING_REMINDER', tenantId: 't1', customerPhone: '+233241234567', variables: ['Cut', '10:00'], entityType: 'booking', entityId: 'b1', bookingId: 'b1' };

beforeEach(() => {
    vi.clearAllMocks();
    db.tenant.findUnique.mockResolvedValue({ outOfWindowMessagesEnabled: true });
    db.messageTemplate.findUnique.mockResolvedValue({ isApproved: true, variableCount: 2, name: 'tpl', language: 'en' });
    db.booking.findFirst.mockResolvedValue({ status: 'CONFIRMED' });
    tryReserveOutbound.mockResolvedValue({ ok: false, used: 0, limit: 100, planId: 'free', reason: 'paused', pauseReason: 'abuse' });
});

describe.each([
    ['notification', processNotification, notif],
    ['reminder', processReminder, reminder],
] as const)('%s job while the tenant is paused', (_name, run, data) => {
    it('delays the job (DelayedError, no failure), raises no quota alert and sends nothing', async () => {
        const j = job({ ...data });
        await expect(run(j, 'tok')).rejects.toBeInstanceOf(DelayedError);
        expect(j.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok');
        const when = j.moveToDelayed.mock.calls[0][0] as number;
        expect(when - Date.now()).toBeGreaterThan(PAUSE_RETRY_DELAY_MS - 5_000);
        expect(when - Date.now()).toBeLessThanOrEqual(PAUSE_RETRY_DELAY_MS);
        expect(db.notification.create).not.toHaveBeenCalled(); // alertDashboard
        expect(raiseAlert).not.toHaveBeenCalled();
        expect(sendTemplateMessage).not.toHaveBeenCalled();
        expect(sendSms).not.toHaveBeenCalled();
        expect(rollbackOutboundReservation).not.toHaveBeenCalled(); // nothing was reserved
    });

    it('drops it quietly (still no quota alert) once the pause has outlasted the cap', async () => {
        const j = job({ ...data, pausedSince: Date.now() - PAUSE_MAX_TOTAL_MS - 1000 });
        await expect(run(j, 'tok')).resolves.toBeUndefined();
        expect(j.moveToDelayed).not.toHaveBeenCalled();
        expect(db.notification.create).not.toHaveBeenCalled();
        expect(raiseAlert).not.toHaveBeenCalled();
        expect(sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('sends normally once the pause is lifted', async () => {
        tryReserveOutbound.mockResolvedValue({ ok: true, used: 1, limit: 100, planId: 'free' });
        await expect(run(job({ ...data, pausedSince: Date.now() - 60_000 }), 'tok')).resolves.toBeUndefined();
        expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    });
});

describe('a real quota refusal is unchanged', () => {
    it('still raises the quota alert and completes the job', async () => {
        tryReserveOutbound.mockResolvedValue({ ok: false, used: 100, limit: 100, planId: 'free', reason: 'quota' });
        const j = job({ ...notif });
        await expect(processNotification(j, 'tok')).resolves.toBeUndefined();
        expect(db.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Message quota exhausted' }) });
        expect(j.moveToDelayed).not.toHaveBeenCalled();
    });
});

describe('a reminder whose booking is cancelled while paused is not sent later', () => {
    it('is skipped by the still-applies check before the pause is even consulted', async () => {
        db.booking.findFirst.mockResolvedValue({ status: 'CANCELLED' });
        await expect(processReminder(job({ ...reminder, pausedSince: Date.now() - 1000 }), 'tok')).resolves.toBeUndefined();
        expect(tryReserveOutbound).not.toHaveBeenCalled();
    });
});
