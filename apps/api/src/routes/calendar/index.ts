import { FastifyPluginAsync } from 'fastify';
import { google } from 'googleapis';
import { z } from 'zod';
import { config } from '../../config';

const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
);

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
];

const calendarRoutes: FastifyPluginAsync = async (fastify) => {
    // ============================================
    // GOOGLE CALENDAR OAUTH
    // ============================================

    // GET /calendar/google/connect - Start OAuth flow
    fastify.get('/google/connect', { preHandler: fastify.authenticate }, async (request, reply) => {
        const state = JSON.stringify({
            tenantId: request.user.tenantId,
            userId: request.user.userId,
        });

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            state: Buffer.from(state).toString('base64'),
            prompt: 'consent',
        });

        return { authUrl };
    });

    // GET /calendar/google/callback - OAuth callback
    fastify.get('/google/callback', async (request, reply) => {
        const { code, state } = request.query as { code: string; state: string };

        if (!code || !state) {
            return reply.redirect(`${config.frontendUrl}/settings?error=missing_params`);
        }

        try {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            const { tenantId, userId } = stateData;

            // Exchange code for tokens
            const { tokens } = await oauth2Client.getToken(code);

            // Store the integration
            await fastify.prisma.calendarIntegration.upsert({
                where: {
                    tenantId_provider: { tenantId, provider: 'GOOGLE' },
                },
                update: {
                    accessToken: tokens.access_token!,
                    refreshToken: tokens.refresh_token || undefined,
                    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                    isActive: true,
                },
                create: {
                    tenantId,
                    provider: 'GOOGLE',
                    accessToken: tokens.access_token!,
                    refreshToken: tokens.refresh_token || undefined,
                    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                    isActive: true,
                },
            });

            return reply.redirect(`${config.frontendUrl}/settings?calendar=connected`);
        } catch (error) {
            console.error('Google OAuth error:', error);
            return reply.redirect(`${config.frontendUrl}/settings?error=oauth_failed`);
        }
    });

    // GET /calendar/status - Get connection status
    fastify.get('/status', { preHandler: fastify.authenticate }, async (request) => {
        const integration = await fastify.prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: {
                    tenantId: request.user.tenantId,
                    provider: 'GOOGLE',
                },
            },
        });

        return {
            connected: !!integration?.isActive,
            provider: integration ? 'GOOGLE' : null,
            lastSync: integration?.lastSyncAt,
        };
    });

    // POST /calendar/disconnect - Disconnect calendar
    fastify.post('/disconnect', { preHandler: fastify.authenticate }, async (request) => {
        await fastify.prisma.calendarIntegration.updateMany({
            where: { tenantId: request.user.tenantId },
            data: { isActive: false },
        });

        return { disconnected: true };
    });

    // ============================================
    // CALENDAR EVENTS
    // ============================================

    // POST /calendar/events - Create calendar event from booking
    fastify.post('/events', { preHandler: fastify.authenticate }, async (request) => {
        const body = z.object({
            bookingId: z.string(),
        }).parse(request.body);

        const tenantId = request.user.tenantId;

        // Get integration
        const integration = await fastify.prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: { tenantId, provider: 'GOOGLE' },
            },
        });

        if (!integration?.isActive) {
            throw fastify.httpErrors.badRequest('Calendar not connected');
        }

        // Get booking
        const booking = await fastify.prisma.booking.findFirst({
            where: { id: body.bookingId, tenantId },
            include: { service: true, tenant: true },
        });

        if (!booking) {
            throw fastify.httpErrors.notFound('Booking not found');
        }

        // Setup OAuth client with tokens
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

        // Create event
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

        // Store calendar event ID on booking
        await fastify.prisma.booking.update({
            where: { id: booking.id },
            data: { calendarEventId: event.data.id },
        });

        return { eventId: event.data.id, eventLink: event.data.htmlLink };
    });

    // DELETE /calendar/events/:bookingId - Delete calendar event
    fastify.delete('/events/:bookingId', { preHandler: fastify.authenticate }, async (request) => {
        const { bookingId } = request.params as { bookingId: string };
        const tenantId = request.user.tenantId;

        const booking = await fastify.prisma.booking.findFirst({
            where: { id: bookingId, tenantId },
        });

        if (!booking?.calendarEventId) {
            throw fastify.httpErrors.notFound('No calendar event found');
        }

        const integration = await fastify.prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: { tenantId, provider: 'GOOGLE' },
            },
        });

        if (!integration?.isActive) {
            throw fastify.httpErrors.badRequest('Calendar not connected');
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

        await fastify.prisma.booking.update({
            where: { id: bookingId },
            data: { calendarEventId: null },
        });

        return { deleted: true };
    });

    // GET /calendar/busy - Get busy times for availability blocking
    fastify.get('/busy', { preHandler: fastify.authenticate }, async (request) => {
        const query = z.object({
            date: z.string(),
        }).parse(request.query);

        const tenantId = request.user.tenantId;
        const date = new Date(query.date);

        const integration = await fastify.prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: { tenantId, provider: 'GOOGLE' },
            },
        });

        if (!integration?.isActive) {
            return { busy: [] };
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

        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: startOfDay.toISOString(),
                timeMax: endOfDay.toISOString(),
                items: [{ id: 'primary' }],
            },
        });

        const busy = response.data.calendars?.primary?.busy || [];

        return {
            busy: busy.map(b => ({
                start: b.start,
                end: b.end,
            })),
        };
    });
};

export default calendarRoutes;
