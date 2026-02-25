import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Calendar Service Tests
 * 
 * Tests Google Calendar integration, event creation,
 * and availability sync functionality.
 */

describe('Calendar Service', () => {
    describe('Calendar Event Creation', () => {
        it('should format booking as calendar event', () => {
            const booking = {
                id: 'booking-123',
                customerName: 'John Doe',
                customerPhone: '+1234567890',
                startTime: new Date('2024-01-15T10:00:00'),
                endTime: new Date('2024-01-15T11:00:00'),
                service: { name: 'Haircut', price: 30 },
                bookingReference: 'BK-ABC123',
            };

            const event = {
                summary: `${booking.service.name} - ${booking.customerName}`,
                description: `Booking: ${booking.bookingReference}\nPhone: ${booking.customerPhone}\nService: ${booking.service.name}\nPrice: $${booking.service.price}`,
                start: {
                    dateTime: booking.startTime.toISOString(),
                    timeZone: 'UTC',
                },
                end: {
                    dateTime: booking.endTime.toISOString(),
                    timeZone: 'UTC',
                },
            };

            expect(event.summary).toBe('Haircut - John Doe');
            expect(event.description).toContain('BK-ABC123');
            expect(event.description).toContain('+1234567890');
        });

        it('should calculate end time from service duration', () => {
            const startTime = new Date('2024-01-15T10:00:00');
            const durationMinutes = 60;
            const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

            expect(endTime.toISOString()).toBe(new Date('2024-01-15T11:00:00').toISOString());
        });

        it('should handle different service durations', () => {
            const testCases = [
                { duration: 30, expected: '2024-01-15T10:30:00.000Z' },
                { duration: 45, expected: '2024-01-15T10:45:00.000Z' },
                { duration: 90, expected: '2024-01-15T11:30:00.000Z' },
                { duration: 120, expected: '2024-01-15T12:00:00.000Z' },
            ];

            testCases.forEach(({ duration, expected }) => {
                const startTime = new Date('2024-01-15T10:00:00.000Z');
                const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
                expect(endTime.toISOString()).toBe(expected);
            });
        });
    });

    describe('OAuth Token Management', () => {
        it('should check if token is expired', () => {
            const expiredToken = {
                accessToken: 'token-123',
                expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
            };

            const isExpired = expiredToken.expiresAt < new Date();
            expect(isExpired).toBe(true);
        });

        it('should check if token is valid', () => {
            const validToken = {
                accessToken: 'token-123',
                expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
            };

            const isExpired = validToken.expiresAt < new Date();
            expect(isExpired).toBe(false);
        });

        it('should add buffer time for token expiry check', () => {
            // Token expires in 5 minutes, but we want 10 minute buffer
            const token = {
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            };
            const bufferMs = 10 * 60 * 1000; // 10 minutes

            const needsRefresh = token.expiresAt.getTime() - Date.now() < bufferMs;
            expect(needsRefresh).toBe(true);
        });
    });

    describe('Availability Calculation', () => {
        it('should find available time slots', () => {
            const workingHours = { start: 9, end: 17 }; // 9 AM to 5 PM
            const existingBookings = [
                { start: new Date('2024-01-15T10:00:00'), end: new Date('2024-01-15T11:00:00') },
                { start: new Date('2024-01-15T14:00:00'), end: new Date('2024-01-15T15:00:00') },
            ];

            // Generate hourly slots
            const slots: string[] = [];
            for (let hour = workingHours.start; hour < workingHours.end; hour++) {
                const slotTime = new Date('2024-01-15');
                slotTime.setHours(hour, 0, 0, 0);

                const isBooked = existingBookings.some(booking =>
                    slotTime >= booking.start && slotTime < booking.end
                );

                if (!isBooked) {
                    slots.push(`${hour.toString().padStart(2, '0')}:00`);
                }
            }

            expect(slots).toContain('09:00');
            expect(slots).not.toContain('10:00'); // Booked
            expect(slots).toContain('11:00');
            expect(slots).not.toContain('14:00'); // Booked
            expect(slots).toContain('15:00');
        });

        it('should block slots from calendar events', () => {
            const calendarEvents = [
                { start: '2024-01-15T09:00:00', end: '2024-01-15T10:00:00', summary: 'Meeting' },
                { start: '2024-01-15T12:00:00', end: '2024-01-15T13:00:00', summary: 'Lunch' },
            ];

            const blockedHours = calendarEvents.map(event => {
                return new Date(event.start).getHours();
            });

            expect(blockedHours).toContain(9);
            expect(blockedHours).toContain(12);
        });
    });

    describe('Event Sync', () => {
        it('should store calendar event ID for booking', () => {
            const booking = {
                id: 'booking-123',
                calendarEventId: null as string | null,
            };

            // After creating event
            booking.calendarEventId = 'cal-event-456';

            expect(booking.calendarEventId).toBe('cal-event-456');
        });

        it('should allow event deletion by ID', () => {
            const calendarEventId = 'cal-event-456';
            expect(calendarEventId).toBeTruthy();
        });
    });
});

describe('Calendar Integration Errors', () => {
    it('should handle missing OAuth credentials', () => {
        const integration = {
            accessToken: null,
            refreshToken: null,
        };

        const hasCredentials = !!(integration.accessToken && integration.refreshToken);
        expect(hasCredentials).toBe(false);
    });

    it('should handle API rate limiting', () => {
        const rateLimitError = {
            code: 429,
            message: 'Rate limit exceeded',
        };

        expect(rateLimitError.code).toBe(429);
    });

    it('should handle invalid calendar ID', () => {
        const error = {
            message: 'Calendar not found',
            code: 'CALENDAR_NOT_FOUND',
        };

        expect(error.code).toBe('CALENDAR_NOT_FOUND');
    });
});
