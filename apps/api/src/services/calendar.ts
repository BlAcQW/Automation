import { google } from 'googleapis';
import { config } from '../config';

interface CalendarIntegration {
    isActive: boolean;
    accessToken: string;
    refreshToken: string | null;
}

interface Booking {
    id: string;
    calendarEventId: string | null;
    customerName: string;
    customerPhone: string;
    bookingReference: string;
    startTime: Date;
    endTime: Date;
    notes: string | null;
    service: { name: string };
    tenant: { timezone: string };
}

interface PrismaLike {
    calendarIntegration: {
        findUnique(args: any): Promise<CalendarIntegration | null>;
    };
    booking: {
        findUnique(args: any): Promise<Booking | null>;
        findFirst(args: any): Promise<Booking | null>;
        update(args: any): Promise<any>;
    };
}

interface SyncBookingParams {
    bookingId: string;
    tenantId: string;
    prisma: PrismaLike;
}

export async function syncBookingToCalendar({ bookingId, tenantId, prisma }: SyncBookingParams): Promise<string | null> {
    try {
        // Check if calendar is connected
        const integration = await prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: { tenantId, provider: 'GOOGLE' },
            },
        });

        if (!integration?.isActive) {
            return null;
        }

        // Get booking details
        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: { service: true, tenant: true },
        });

        if (!booking || booking.calendarEventId) {
            return booking?.calendarEventId || null;
        }

        // Setup OAuth client
        const authClient = new google.auth.OAuth2(
            config.google.clientId,
            config.google.clientSecret,
            config.google.redirectUri
        );
        authClient.setCredentials({
            access_token: integration.accessToken,
            refresh_token: integration.refreshToken || undefined,
        });

        const calendar = google.calendar({ version: 'v3', auth: authClient });

        // Create calendar event
        const event = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: `${booking.service.name} - ${booking.customerName}`,
                description: `Booking: ${booking.bookingReference}\nPhone: ${booking.customerPhone}\n${booking.notes || ''}`,
                start: {
                    dateTime: booking.startTime.toISOString(),
                    timeZone: booking.tenant.timezone,
                },
                end: {
                    dateTime: booking.endTime.toISOString(),
                    timeZone: booking.tenant.timezone,
                },
            },
        });

        // Update booking with calendar event ID
        await prisma.booking.update({
            where: { id: bookingId },
            data: { calendarEventId: event.data.id },
        });

        return event.data.id || null;
    } catch (error) {
        console.error('Failed to sync booking to calendar:', error);
        return null;
    }
}

export async function deleteCalendarEvent(bookingId: string, tenantId: string, prisma: PrismaLike): Promise<boolean> {
    try {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, tenantId },
        });

        if (!booking?.calendarEventId) {
            return false;
        }

        const integration = await prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: { tenantId, provider: 'GOOGLE' },
            },
        });

        if (!integration?.isActive) {
            return false;
        }

        const authClient = new google.auth.OAuth2(
            config.google.clientId,
            config.google.clientSecret,
            config.google.redirectUri
        );
        authClient.setCredentials({
            access_token: integration.accessToken,
            refresh_token: integration.refreshToken || undefined,
        });

        const calendar = google.calendar({ version: 'v3', auth: authClient });

        await calendar.events.delete({
            calendarId: 'primary',
            eventId: booking.calendarEventId,
        });

        await prisma.booking.update({
            where: { id: bookingId },
            data: { calendarEventId: null },
        });

        return true;
    } catch (error) {
        console.error('Failed to delete calendar event:', error);
        return false;
    }
}
