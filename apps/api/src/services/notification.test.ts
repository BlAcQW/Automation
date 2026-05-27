import { describe, it, expect, vi } from 'vitest';
import { TemplatePurpose } from '@prisma/client';
import { scheduleNotification, scheduleReminder, cancelReminder } from './notification';

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
