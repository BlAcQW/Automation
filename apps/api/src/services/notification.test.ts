import { describe, it, expect, vi } from 'vitest';
import { TemplatePurpose } from '@prisma/client';
import { scheduleNotification, scheduleReminder, cancelReminder, cancelEntityReminder } from './notification';

describe('Notification Service', () => {
    describe('scheduleNotification', () => {
        it('schedules a template-driven notification job', async () => {
            const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'job-123' }) };

            const result = await scheduleNotification({
                queue: mockQueue as any,
                purpose: TemplatePurpose.BOOKING_CONFIRMATION,
                tenantId: 'tenant-123',
                customerPhone: '+1234567890',
                variables: ['John', 'Haircut', '2026-05-20', '10:00', 'BK-ABC123'],
                jobId: 'booking_confirmation_booking-456',
            });

            expect(result).toBe('job-123');
            expect(mockQueue.add).toHaveBeenCalledWith(
                TemplatePurpose.BOOKING_CONFIRMATION,
                expect.objectContaining({
                    purpose: TemplatePurpose.BOOKING_CONFIRMATION,
                    tenantId: 'tenant-123',
                    customerPhone: '+1234567890',
                    variables: ['John', 'Haircut', '2026-05-20', '10:00', 'BK-ABC123'],
                }),
                expect.objectContaining({ jobId: 'booking_confirmation_booking-456' }),
            );
        });

        it('returns null if queue is not available', async () => {
            const result = await scheduleNotification({
                queue: null,
                purpose: TemplatePurpose.BOOKING_CONFIRMATION,
                tenantId: 'tenant-123',
                customerPhone: '+1234567890',
                variables: [],
            });
            expect(result).toBeNull();
        });

        it('honours the delay option', async () => {
            const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'job-123' }) };

            await scheduleNotification({
                queue: mockQueue as any,
                purpose: TemplatePurpose.ORDER_SHIPPED,
                tenantId: 'tenant-123',
                customerPhone: '+1234567890',
                variables: ['ORD-ABC123'],
                delay: 5000,
            });

            expect(mockQueue.add).toHaveBeenCalledWith(
                TemplatePurpose.ORDER_SHIPPED,
                expect.any(Object),
                expect.objectContaining({ delay: 5000 }),
            );
        });
    });

    describe('scheduleReminder', () => {
        it('schedules a reminder job with stable jobId per booking', async () => {
            const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'reminder-123' }) };
            const sendAt = new Date(Date.now() + 120 * 60_000); // 2 hours from now

            const result = await scheduleReminder({
                queue: mockQueue as any,
                tenantId: 'tenant-123',
                bookingId: 'booking-456',
                customerPhone: '+1234567890',
                variables: ['Haircut', '10:00'],
                sendAt,
            });

            expect(result).toBe('reminder-123');
            expect(mockQueue.add).toHaveBeenCalledWith(
                'booking_reminder',
                expect.objectContaining({
                    purpose: TemplatePurpose.BOOKING_REMINDER,
                    tenantId: 'tenant-123',
                    bookingId: 'booking-456',
                    variables: ['Haircut', '10:00'],
                }),
                expect.objectContaining({
                    delay: expect.any(Number),
                    jobId: 'reminder-booking-456',
                }),
            );
        });

        it('does NOT schedule when sendAt is in the past', async () => {
            const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'reminder-123' }) };

            const result = await scheduleReminder({
                queue: mockQueue as any,
                tenantId: 'tenant-123',
                bookingId: 'booking-456',
                customerPhone: '+1234567890',
                variables: ['Haircut', '10:00'],
                sendAt: new Date(Date.now() - 5000),
            });

            expect(result).toBeNull();
            expect(mockQueue.add).not.toHaveBeenCalled();
        });
    });

    describe('cancelReminder', () => {
        it('cancels an existing reminder by stable jobId', async () => {
            const mockJob = { remove: vi.fn().mockResolvedValue(true) };
            const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };

            const result = await cancelReminder(mockQueue as any, 'booking-456');

            expect(result).toBe(true);
            expect(mockQueue.getJob).toHaveBeenCalledWith('reminder-booking-456');
            expect(mockJob.remove).toHaveBeenCalled();
        });

        it('returns false when no job is found', async () => {
            const mockQueue = { getJob: vi.fn().mockResolvedValue(null) };

            const result = await cancelReminder(mockQueue as any, 'booking-456');
            expect(result).toBe(false);
        });
    });
});

describe('generic reminders', () => {
    it('schedules a reminder for a non-booking entity with its own jobId and name', async () => {
        const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'j' }) };
        await scheduleReminder({
            queue: mockQueue as any,
            tenantId: 't1',
            entityType: 'ride',
            entityId: 'r9',
            purpose: TemplatePurpose.BOOKING_REMINDER,
            customerPhone: '+233241234567',
            customerId: 'c1',
            variables: ['08:00'],
            sendAt: new Date(Date.now() + 3600_000),
        } as any);
        expect(mockQueue.add).toHaveBeenCalledWith(
            'ride_reminder',
            expect.objectContaining({ entityType: 'ride', entityId: 'r9', customerId: 'c1', variables: ['08:00'] }),
            expect.objectContaining({ jobId: 'reminder-ride-r9' }),
        );
        expect(mockQueue.add.mock.calls[0][1].bookingId).toBeUndefined();
    });

    it('keeps booking reminders readable by a worker that predates the generic payload', async () => {
        const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'j' }) };
        await scheduleReminder({
            queue: mockQueue as any, tenantId: 't1', bookingId: 'b1',
            customerPhone: '+233241234567', variables: ['a', 'b'], sendAt: new Date(Date.now() + 3600_000),
        });
        expect(mockQueue.add.mock.calls[0][1]).toEqual(
            expect.objectContaining({ bookingId: 'b1', entityType: 'booking', entityId: 'b1', purpose: 'BOOKING_REMINDER' }),
        );
    });

    it('rejects a malformed entity type or empty id rather than queueing a job nobody can check', async () => {
        const mockQueue = { add: vi.fn() };
        const args = { queue: mockQueue as any, tenantId: 't1', customerPhone: '+1', variables: [], sendAt: new Date(Date.now() + 3600_000), purpose: TemplatePurpose.BOOKING_REMINDER };
        await expect(scheduleReminder({ ...args, entityType: 'Bad Type', entityId: 'x' })).rejects.toThrow();
        await expect(scheduleReminder({ ...args, entityType: 'ride', entityId: '' })).rejects.toThrow();
        expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('cancels a generic reminder by entity', async () => {
        const mockJob = { remove: vi.fn() };
        const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
        expect(await cancelEntityReminder(mockQueue as any, 'ride', 'r9')).toBe(true);
        expect(mockQueue.getJob).toHaveBeenCalledWith('reminder-ride-r9');
        expect(await cancelEntityReminder(null, 'ride', 'r9')).toBe(false);
    });
});
