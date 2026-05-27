import { FastifyPluginAsync } from 'fastify';
import { google } from 'googleapis';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { encrypt } from '../../services/crypto.js';
import { buildGoogleAuthClient } from '../../services/calendar.js';
import { signOAuthState, verifyOAuthState } from '../../services/oauth-state.js';
import { audit } from '../../services/audit.js';

const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
);

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
];

const calendarRoutes: FastifyPluginAsync = async (fastify) => {
    // ============================================
    // GOOGLE CALENDAR OAUTH
    // ============================================

    fastify.get('/google/connect', { preHandler: fastify.authenticate }, async (request) => {
        // Signed, time-limited state prevents CSRF binding of attacker
        // calendars onto victim tenants.
        const state = signOAuthState({
            tenantId: request.user.tenantId,
            userId: request.user.userId,
        });

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            state,
            prompt: 'consent',
        });

        return { authUrl };
    });

    fastify.get('/google/callback', async (request, reply) => {
        const { code, state } = request.query as { code?: string; state?: string };

        if (!code || !state) {
            return reply.redirect(`${config.frontendUrl}/settings?error=missing_params`);
        }

        let tenantId: string;
        try {
            ({ tenantId } = verifyOAuthState(state));
        } catch (err) {
            fastify.log.warn({ err }, 'OAuth state verification failed');
            return reply.redirect(`${config.frontendUrl}/settings?error=invalid_state`);
        }

        try {
            const { tokens } = await oauth2Client.getToken(code);

            if (!tokens.access_token) {
                return reply.redirect(`${config.frontendUrl}/settings?error=no_access_token`);
            }

            // Encrypt at rest. A DB dump must not yield usable Google tokens.
            const encryptedAccess = encrypt(tokens.access_token);
            const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
            const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

            await fastify.prisma.calendarIntegration.upsert({
                where: { tenantId_provider: { tenantId, provider: 'GOOGLE' } },
                update: {
                    accessToken: encryptedAccess,
                    ...(encryptedRefresh && { refreshToken: encryptedRefresh }),
                    expiresAt,
                    isActive: true,
                },
                create: {
                    tenantId,
                    provider: 'GOOGLE',
                    accessToken: encryptedAccess,
                    refreshToken: encryptedRefresh,
                    expiresAt,
                    isActive: true,
                },
            });

            await audit({
                prisma: fastify.prisma,
                action: 'calendar.connected',
                actorType: 'USER',
                tenantId,
                metadata: { provider: 'GOOGLE' },
                ipAddress: request.ip,
            });

            return reply.redirect(`${config.frontendUrl}/settings?calendar=connected`);
        } catch (error) {
            fastify.log.error({ err: error }, 'Google OAuth callback failed');
            return reply.redirect(`${config.frontendUrl}/settings?error=oauth_failed`);
        }
    });

    fastify.get('/status', { preHandler: fastify.authenticate }, async (request) => {
        const integration = await fastify.prisma.calendarIntegration.findUnique({
            where: {
                tenantId_provider: { tenantId: request.user.tenantId, provider: 'GOOGLE' },
            },
        });

        return {
            connected: !!integration?.isActive,
            provider: integration ? 'GOOGLE' : null,
            connectedAt: integration?.createdAt ?? null,
        };
    });

    fastify.post('/disconnect', { preHandler: fastify.authenticate }, async (request) => {
        await fastify.prisma.calendarIntegration.updateMany({
            where: { tenantId: request.user.tenantId },
            data: { isActive: false },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'calendar.disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            ipAddress: request.ip,
        });
        return { disconnected: true };
    });

    // ============================================
    // CALENDAR EVENTS
    // ============================================

    fastify.post('/events', { preHandler: fastify.authenticate }, async (request) => {
        const body = z.object({ bookingId: z.string() }).parse(request.body);
        const tenantId = request.user.tenantId;

        const authClient = await buildGoogleAuthClient(fastify.prisma, tenantId);
        if (!authClient) {
            throw fastify.httpErrors.badRequest('Calendar not connected');
        }

        const booking = await fastify.prisma.booking.findFirst({
            where: { id: body.bookingId, tenantId },
            include: { service: true, tenant: true },
        });

        if (!booking) {
            throw fastify.httpErrors.notFound('Booking not found');
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

        await fastify.prisma.booking.update({
            where: { id: booking.id },
            data: { calendarEventId: event.data.id },
        });

        return { eventId: event.data.id, eventLink: event.data.htmlLink };
    });

    fastify.delete('/events/:bookingId', { preHandler: fastify.authenticate }, async (request) => {
        const { bookingId } = request.params as { bookingId: string };
        const tenantId = request.user.tenantId;

        const booking = await fastify.prisma.booking.findFirst({
            where: { id: bookingId, tenantId },
        });

        if (!booking?.calendarEventId) {
            throw fastify.httpErrors.notFound('No calendar event found');
        }

        const authClient = await buildGoogleAuthClient(fastify.prisma, tenantId);
        if (!authClient) {
            throw fastify.httpErrors.badRequest('Calendar not connected');
        }

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

    fastify.get('/busy', { preHandler: fastify.authenticate }, async (request) => {
        const query = z.object({ date: z.string() }).parse(request.query);
        const tenantId = request.user.tenantId;
        const date = new Date(query.date);

        const authClient = await buildGoogleAuthClient(fastify.prisma, tenantId);
        if (!authClient) {
            return { busy: [] };
        }

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
            busy: busy.map((b) => ({ start: b.start, end: b.end })),
        };
    });
};

export default calendarRoutes;
