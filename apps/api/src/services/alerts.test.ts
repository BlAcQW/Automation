import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delegates through a plain function so a throwing implementation is not
// recorded by the spy (vitest 1.x fails the test on spy-recorded throws).
const captured = vi.hoisted(() => {
    const state = { impl: (_a: unknown): void => undefined };
    const spy = vi.fn();
    return { state, spy, captureAlertEvent: (a: unknown) => { spy(a); state.impl(a); } };
});
vi.mock('../lib/sentry.js', () => ({ captureAlertEvent: captured.captureAlertEvent }));

import { raiseAlert, resolveAlert } from './alerts.js';

function makePrisma() {
    return {
        platformAlert: {
            upsert: vi.fn().mockResolvedValue({ id: 'a1' }),
            update: vi.fn().mockResolvedValue({ id: 'a1' }),
        },
    };
}

describe('raiseAlert', () => {
    beforeEach(() => { captured.spy.mockReset(); captured.state.impl = () => undefined; });

    it('upserts on dedupeKey, creating with count 1', async () => {
        const prisma = makePrisma();
        await raiseAlert(prisma as never, {
            kind: 'payment.unattributed',
            severity: 'critical',
            tenantId: 't1',
            message: 'boom',
            context: { reference: 'r1' },
            dedupeKey: 'payment.unattributed:r1',
        });
        const arg = prisma.platformAlert.upsert.mock.calls[0][0];
        expect(arg.where).toEqual({ dedupeKey: 'payment.unattributed:r1' });
        expect(arg.create).toMatchObject({
            kind: 'payment.unattributed',
            severity: 'critical',
            tenantId: 't1',
            message: 'boom',
            dedupeKey: 'payment.unattributed:r1',
        });
    });

    it('on recurrence increments count, refreshes lastSeenAt and reopens', async () => {
        const prisma = makePrisma();
        await raiseAlert(prisma as never, { kind: 'k', severity: 'warning', message: 'm2', dedupeKey: 'd' });
        const { update, create } = prisma.platformAlert.upsert.mock.calls[0][0];
        expect(update.count).toEqual({ increment: 1 });
        expect(update.lastSeenAt).toBeInstanceOf(Date);
        expect(update.resolvedAt).toBeNull();
        expect(update.resolvedBy).toBeNull();
        expect(update.message).toBe('m2');
        expect(create.tenantId).toBeNull();
    });

    it('never throws when the database fails', async () => {
        const prisma = makePrisma();
        prisma.platformAlert.upsert.mockRejectedValue(new Error('db down'));
        await expect(
            raiseAlert(prisma as never, { kind: 'k', severity: 'info', message: 'm', dedupeKey: 'd' }),
        ).resolves.toBeUndefined();
    });

    it('never throws when Sentry fails', async () => {
        const prisma = makePrisma();
        captured.state.impl = () => {
            throw new Error('sentry down');
        };
        await expect(
            raiseAlert(prisma as never, { kind: 'k', severity: 'info', message: 'm', dedupeKey: 'd' }),
        ).resolves.toBeUndefined();
    });

    it('reports to Sentry with kind/severity/tenantId and no message body', async () => {
        const prisma = makePrisma();
        await raiseAlert(prisma as never, {
            kind: 'k', severity: 'critical', tenantId: 't9', message: 'has a phone +233', dedupeKey: 'd',
        });
        expect(captured.spy).toHaveBeenCalledWith({ kind: 'k', severity: 'critical', tenantId: 't9' });
    });
});

describe('resolveAlert', () => {
    it('marks resolved with who and when', async () => {
        const prisma = makePrisma();
        await resolveAlert(prisma as never, 'a1', 'admin1');
        const arg = prisma.platformAlert.update.mock.calls[0][0];
        expect(arg.where).toEqual({ id: 'a1' });
        expect(arg.data.resolvedBy).toBe('admin1');
        expect(arg.data.resolvedAt).toBeInstanceOf(Date);
    });
});

describe('raiseAlert size bounds', () => {
    // Message, key and context can carry data from outside (a payment
    // reference, a purpose name) — they must never grow without limit.
    it('caps message, dedupeKey and string values in context', async () => {
        const prisma = { platformAlert: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn() } } as any;
        const huge = 'x'.repeat(50_000);
        await raiseAlert(prisma, {
            kind: 'k', severity: 'warning', message: huge, dedupeKey: `d:${huge}`,
            context: { reference: huge, nested: { note: huge }, list: [huge], n: 5 },
        });
        const { create, where } = prisma.platformAlert.upsert.mock.calls[0][0];
        expect(create.message.length).toBeLessThanOrEqual(500);
        expect(where.dedupeKey.length).toBeLessThanOrEqual(200);
        expect(create.dedupeKey).toBe(where.dedupeKey);
        expect(JSON.stringify(create.context).length).toBeLessThanOrEqual(4_000);
        expect(create.context.n).toBe(5);
    });
});
