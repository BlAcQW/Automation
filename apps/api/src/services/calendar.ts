import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { config } from '../config/index.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * Build a Google OAuth2 client preloaded with the tenant's decrypted tokens
 * and wired with a `tokens` listener that persists refreshed access / refresh
 * tokens back to the database (encrypted at rest).
 *
 * Returns null if the tenant has no active Google integration.
 */
export async function buildGoogleAuthClient(prisma: ExtendedPrismaClient, tenantId: string): Promise<OAuth2Client | null> {
    const integration = await prisma.calendarIntegration.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'GOOGLE' } },
    });

    if (!integration || !integration.isActive) {
        return null;
    }

    const accessToken = integration.accessToken ? decrypt(integration.accessToken) : undefined;
    const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : undefined;

    const authClient = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri,
    );

    authClient.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry_date: integration.expiresAt ? integration.expiresAt.getTime() : undefined,
    });

    // Persist refreshed credentials encrypted. googleapis emits this event each
    // time it auto-refreshes the access token via the refresh token.
    authClient.on('tokens', (tokens) => {
        const update: Record<string, unknown> = {};
        if (tokens.access_token) {
            update.accessToken = encrypt(tokens.access_token);
        }
        if (tokens.refresh_token) {
            update.refreshToken = encrypt(tokens.refresh_token);
        }
        if (tokens.expiry_date) {
            update.expiresAt = new Date(tokens.expiry_date);
        }
        if (Object.keys(update).length === 0) return;

        prisma.calendarIntegration
            .update({
                where: { tenantId_provider: { tenantId, provider: 'GOOGLE' } },
                data: update,
            })
            .catch(async (err) => {
                // Refresh persistence failure is non-fatal for the CURRENT
                // request, but every subsequent sync will use the stale
                // token until the operator reconnects. Surface a dashboard
                // notification so the issue doesn't compound silently.
                // eslint-disable-next-line no-console
                console.error('Failed to persist refreshed Google tokens', err);
                await prisma.notification.create({
                    data: {
                        tenantId,
                        type: 'SYSTEM',
                        title: 'Reconnect Google Calendar',
                        message: 'Failed to refresh Google Calendar tokens. Reauthorize at /settings to keep bookings synced.',
                        metadata: { error: err instanceof Error ? err.message : String(err) },
                    },
                }).catch(() => undefined);
            });
    });

    return authClient;
}

export async function syncBookingToCalendar({
    bookingId,
    tenantId,
    prisma,
}: {
    bookingId: string;
    tenantId: string;
    prisma: ExtendedPrismaClient;
}): Promise<string | null> {
    try {
        const authClient = await buildGoogleAuthClient(prisma, tenantId);
        if (!authClient) return null;

        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, tenantId },
            include: { service: true, tenant: true },
        });

        if (!booking || booking.calendarEventId) {
            return booking?.calendarEventId ?? null;
        }

        const calendar = google.calendar({ version: 'v3', auth: authClient });
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

        await prisma.booking.update({
            where: { id: bookingId },
            data: { calendarEventId: event.data.id },
        });

        return event.data.id ?? null;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to sync booking to calendar:', error);
        return null;
    }
}

/**
 * Update an existing calendar event's start/end times to match the booking's
 * current schedule. Used when a customer reschedules via the bot.
 *
 * Best-effort: returns false on any failure so the caller can swallow the
 * error and still report the reschedule as successful to the customer.
 */
export async function updateCalendarEvent(
    bookingId: string,
    tenantId: string,
    prisma: ExtendedPrismaClient,
): Promise<boolean> {
    try {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, tenantId },
            include: { tenant: true },
        });
        if (!booking?.calendarEventId) return false;

        const authClient = await buildGoogleAuthClient(prisma, tenantId);
        if (!authClient) return false;

        const calendar = google.calendar({ version: 'v3', auth: authClient });
        await calendar.events.patch({
            calendarId: 'primary',
            eventId: booking.calendarEventId,
            requestBody: {
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
        return true;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to update calendar event:', error);
        return false;
    }
}

export async function deleteCalendarEvent(
    bookingId: string,
    tenantId: string,
    prisma: ExtendedPrismaClient,
): Promise<boolean> {
    try {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, tenantId },
        });
        if (!booking?.calendarEventId) return false;

        const authClient = await buildGoogleAuthClient(prisma, tenantId);
        if (!authClient) return false;

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
        // eslint-disable-next-line no-console
        console.error('Failed to delete calendar event:', error);
        return false;
    }
}
