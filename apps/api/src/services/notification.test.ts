import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    scheduleNotification,
    scheduleReminder,
    cancelReminder,
    scheduleBookingConfirmation,
    scheduleOrderConfirmation,
    getNotificationMessage,
} from './notification';

describe('Notification Service', () => {
    describe('scheduleNotification', () => {
        it('should schedule a notification job', async () => {
            const mockQueue = {
                add: vi.fn().mockResolvedValue({ id: 'job-123' }),
            };

            const result = await scheduleNotification(mockQueue as any, {
                tenantId: 'tenant-123',
                type: 'booking_confirmation',
                customerPhone: '+1234567890',
                data: { bookingId: 'booking-456' },
            });

            expect(result).toBe('job-123');
            expect(mockQueue.add).toHaveBeenCalledWith(
                'booking_confirmation',
                expect.objectContaining({
                    type: 'booking_confirmation',
                    tenantId: 'tenant-123',
                    customerPhone: '+1234567890',
                    bookingId: 'booking-456',
                }),
                expect.any(Object)
            );
        });

        it('should return null if queue is not available', async () => {
            const result = await scheduleNotification(null, {
                tenantId: 'tenant-123',
                type: 'booking_confirmation',
                customerPhone: '+1234567890',
                data: {},
            });

            expect(result).toBeNull();
        });

        it('should schedule with delay', async () => {
            const mockQueue = {
                add: vi.fn().mockResolvedValue({ id: 'job-123' }),
            };

            await scheduleNotification(mockQueue as any, {
                tenantId: 'tenant-123',
                type: 'order_shipped',
                customerPhone: '+1234567890',
                data: {},
                delay: 5000,
            });

            expect(mockQueue.add).toHaveBeenCalledWith(
                'order_shipped',
                expect.any(Object),
                expect.objectContaining({ delay: 5000 })
            );
        });
    });

    describe('scheduleReminder', () => {
        it('should schedule reminder 60 minutes before appointment', async () => {
            const mockQueue = {
                add: vi.fn().mockResolvedValue({ id: 'reminder-123' }),
            };

            const startTime = new Date(Date.now() + 120 * 60 * 1000); // 2 hours from now

            const result = await scheduleReminder(mockQueue as any, {
                tenantId: 'tenant-123',
                bookingId: 'booking-456',
                customerPhone: '+1234567890',
                serviceName: 'Haircut',
                startTime,
            });

            expect(result).toBe('reminder-123');
            expect(mockQueue.add).toHaveBeenCalledWith(
                'booking_reminder',
                expect.objectContaining({
                    tenantId: 'tenant-123',
                    bookingId: 'booking-456',
                    serviceName: 'Haircut',
                }),
                expect.objectContaining({
                    delay: expect.any(Number),
                    jobId: 'reminder-booking-456-60min',
                })
            );
        });

        it('should NOT schedule if reminder time already passed', async () => {
            const mockQueue = {
                add: vi.fn().mockResolvedValue({ id: 'reminder-123' }),
            };

            const startTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

            const result = await scheduleReminder(mockQueue as any, {
                tenantId: 'tenant-123',
                bookingId: 'booking-456',
                customerPhone: '+1234567890',
                serviceName: 'Haircut',
                startTime,
            });

            expect(result).toBeNull();
            expect(mockQueue.add).not.toHaveBeenCalled();
        });
    });

    describe('cancelReminder', () => {
        it('should cancel an existing reminder', async () => {
            const mockJob = { remove: vi.fn().mockResolvedValue(true) };
            const mockQueue = {
                getJob: vi.fn().mockResolvedValue(mockJob),
            };

            const result = await cancelReminder(mockQueue as any, 'booking-456');

            expect(result).toBe(true);
            expect(mockQueue.getJob).toHaveBeenCalledWith('reminder-booking-456-60min');
            expect(mockJob.remove).toHaveBeenCalled();
        });

        it('should return false if job not found', async () => {
            const mockQueue = {
                getJob: vi.fn().mockResolvedValue(null),
            };

            const result = await cancelReminder(mockQueue as any, 'booking-456');

            expect(result).toBe(false);
        });
    });

    describe('scheduleBookingConfirmation', () => {
        it('should schedule booking confirmation with all details', async () => {
            const mockQueue = {
                add: vi.fn().mockResolvedValue({ id: 'job-123' }),
            };

            await scheduleBookingConfirmation(mockQueue as any, 'tenant-123', {
                id: 'booking-456',
                customerPhone: '+1234567890',
                customerName: 'John Doe',
                serviceName: 'Haircut',
                startTime: new Date('2024-01-15T10:00:00'),
                bookingReference: 'BK-ABC123',
            });

            expect(mockQueue.add).toHaveBeenCalledWith(
                'booking_confirmation',
                expect.objectContaining({
                    type: 'booking_confirmation',
                    bookingId: 'booking-456',
                    customerName: 'John Doe',
                    serviceName: 'Haircut',
                    bookingReference: 'BK-ABC123',
                }),
                expect.any(Object)
            );
        });
    });

    describe('scheduleOrderConfirmation', () => {
        it('should schedule order confirmation', async () => {
            const mockQueue = {
                add: vi.fn().mockResolvedValue({ id: 'job-123' }),
            };

            await scheduleOrderConfirmation(mockQueue as any, 'tenant-123', {
                id: 'order-456',
                orderNumber: 'ORD-ABC123',
                customerPhone: '+1234567890',
                customerName: 'Jane Doe',
                totalAmount: 99.99,
            });

            expect(mockQueue.add).toHaveBeenCalledWith(
                'order_confirmation',
                expect.objectContaining({
                    type: 'order_confirmation',
                    orderNumber: 'ORD-ABC123',
                    totalAmount: 99.99,
                }),
                expect.any(Object)
            );
        });
    });

    describe('getNotificationMessage', () => {
        it('should generate booking confirmation message', () => {
            const message = getNotificationMessage('booking_confirmation', {
                serviceName: 'Haircut',
                startTime: '2024-01-15T10:00:00',
                bookingReference: 'BK-ABC123',
            });

            expect(message).toContain('Booking Confirmed');
            expect(message).toContain('Haircut');
            expect(message).toContain('BK-ABC123');
        });

        it('should generate booking reminder message', () => {
            const message = getNotificationMessage('booking_reminder', {
                serviceName: 'Haircut',
                startTime: '2024-01-15T10:00:00',
            });

            expect(message).toContain('Reminder');
            expect(message).toContain('1 hour');
            expect(message).toContain('Haircut');
        });

        it('should generate order confirmation message', () => {
            const message = getNotificationMessage('order_confirmation', {
                orderNumber: 'ORD-ABC123',
                totalAmount: 99.99,
            });

            expect(message).toContain('Order Confirmed');
            expect(message).toContain('ORD-ABC123');
            expect(message).toContain('99.99');
        });

        it('should generate order shipped message', () => {
            const message = getNotificationMessage('order_shipped', {
                orderNumber: 'ORD-ABC123',
            });

            expect(message).toContain('on its way');
            expect(message).toContain('ORD-ABC123');
        });

        it('should generate order delivered message', () => {
            const message = getNotificationMessage('order_delivered', {
                orderNumber: 'ORD-ABC123',
            });

            expect(message).toContain('Delivered');
            expect(message).toContain('ORD-ABC123');
        });
    });
});
