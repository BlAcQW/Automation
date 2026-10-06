import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import {
    discoverPages,
    subscribePageToWebhooks,
    PageConnectError,
} from '../../services/meta-pages.js';
import { disconnectFacebookPage } from '../../services/facebook-connection.js';

/**
 * Connecting Instagram and Facebook Messenger.
 *
 * Deliberately two steps rather than one. Facebook Login returns every Page the
 * person administers, and a salon owner may well administer a friend's Page or
 * an old one they forgot about. Silently taking the first result is how the
 * wrong business ends up wired to someone else's bookings, so the tenant picks.
 */
const channelRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /channels/status — drives the whole Channels screen in one call.
    fastify.get('/status', { preHandler: [fastify.authenticate] }, async (request) => {
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: {
                whatsappPhoneNumberId: true,
                whatsappDisplayNumber: true,
                whatsappHosted: true,
                whatsappNumberStatus: true,
                facebookPageId: true,
                facebookPageName: true,
                instagramUserId: true,
                instagramUsername: true,
                whatsappConnectedAt: true,
                whatsappConnectionMode: true,
                facebookConnectedAt: true,
                instagramConnectedAt: true,
            },
        });

        const whatsappAwaitingCode =
            !!tenant?.whatsappHosted && (tenant.whatsappNumberStatus === 'PENDING_CODE' || tenant.whatsappNumberStatus === 'VERIFIED');
        const whatsappConnected = !!tenant?.whatsappPhoneNumberId && !whatsappAwaitingCode;

        return {
            whatsapp: {
                connected: whatsappConnected,
                label: tenant?.whatsappDisplayNumber ?? null,
                awaitingCode: whatsappAwaitingCode,
                mode: tenant?.whatsappPhoneNumberId ? tenant.whatsappConnectionMode ?? (tenant.whatsappHosted ? 'BOOKLY_HOSTED' : 'OWN_ACCOUNT') : null,
                connectedAt: whatsappConnected ? tenant?.whatsappConnectedAt ?? null : null,
                // WhatsApp is the only channel Meta charges for.
                billedByMeta: true,
            },
            messenger: {
                connected: !!tenant?.facebookPageId,
                label: tenant?.facebookPageName ?? null,
                pageName: tenant?.facebookPageName ?? null,
                connectedAt: tenant?.facebookPageId ? tenant.facebookConnectedAt ?? null : null,
                billedByMeta: false,
            },
            instagram: {
                connected: !!tenant?.instagramUserId,
                label: tenant?.instagramUsername ? `@${tenant.instagramUsername}` : null,
                username: tenant?.instagramUsername ?? null,
                connectedAt: tenant?.instagramUserId ? tenant.instagramConnectedAt ?? null : null,
                // Instagram rides on the Page, so it cannot be connected alone.
                requiresPage: true,
                billedByMeta: false,
            },
        };
    });

    // POST /channels/facebook/pages — exchange the login code and list Pages.
    // Nothing is stored yet; the tenant has not chosen.
    fastify.post('/facebook/pages', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '10 minutes',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:fb-pages`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect channels');
        }

        const body = z.object({
            code: z.string().min(1),
            redirectUri: z.string().url().optional(),
        }).parse(request.body);

        try {
            const pages = await discoverPages(body.code, body.redirectUri);
            if (pages.length === 0) {
                throw fastify.httpErrors.badRequest(
                    'No Facebook Pages found on that account. Create a Page for your business first, then try again.',
                );
            }
            // Tokens stay server-side; the client only needs enough to choose.
            return {
                pages: pages.map((p) => ({
                    pageId: p.pageId,
                    pageName: p.pageName,
                    instagramUsername: p.instagramUsername ?? null,
                    hasInstagram: !!p.instagramUserId,
                })),
                // Short-lived handoff so the follow-up select call does not
                // need a second OAuth round trip.
                selectionToken: encrypt(JSON.stringify({ pages, at: Date.now() })),
            };
        } catch (err) {
            if (err instanceof PageConnectError) {
                fastify.log.error({ step: err.step, details: err.details }, 'page discovery failed');
                throw fastify.httpErrors.badRequest(
                    'Could not read your Facebook Pages. Make sure you granted access to the Page you want to use.',
                );
            }
            throw err;
        }
    });

    // POST /channels/facebook/select — store the chosen Page and subscribe.
    fastify.post('/facebook/select', {
        preHandler: [fastify.authenticate],
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect channels');
        }

        const body = z.object({
            selectionToken: z.string().min(1),
            pageId: z.string().min(1),
            /** Connect Instagram too, when the Page has an account linked. */
            includeInstagram: z.boolean().default(true),
        }).parse(request.body);

        let pages: Array<{
            pageId: string;
            pageName: string;
            pageToken: string;
            instagramUserId?: string;
            instagramUsername?: string;
        }>;
        let issuedAt = 0;
        try {
            const decoded = JSON.parse(decrypt(body.selectionToken));
            pages = decoded.pages;
            issuedAt = decoded.at ?? 0;
        } catch {
            throw fastify.httpErrors.badRequest('That selection expired. Start the connection again.');
        }

        // The token carries a live Page access token, so it must not stay
        // usable indefinitely if it leaks from a client log.
        if (Date.now() - issuedAt > 15 * 60 * 1000) {
            throw fastify.httpErrors.badRequest('That selection expired. Start the connection again.');
        }

        const chosen = pages.find((p) => p.pageId === body.pageId);
        if (!chosen) {
            throw fastify.httpErrors.badRequest('That Page was not in your list. Start again.');
        }

        // One Page belongs to one tenant: inbound webhooks are routed by Page
        // id, so a duplicate would deliver another business's messages here.
        const clash = await fastify.prisma.tenant.findFirst({
            where: { facebookPageId: chosen.pageId, NOT: { id: request.user.tenantId } },
            select: { id: true },
        });
        if (clash) {
            throw fastify.httpErrors.conflict('That Page is already connected to another Bookly account.');
        }

        try {
            await subscribePageToWebhooks(chosen.pageId, chosen.pageToken);
        } catch (err) {
            fastify.log.error({ err }, 'page webhook subscribe failed');
            throw fastify.httpErrors.badRequest(
                'Connected, but Meta would not enable message delivery for that Page. Check you are an admin of it.',
            );
        }

        const linkInstagram = body.includeInstagram && !!chosen.instagramUserId;
        const now = new Date();

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                facebookPageId: chosen.pageId,
                facebookPageName: chosen.pageName,
                facebookPageToken: encrypt(chosen.pageToken),
                facebookConnectedAt: now,
                facebookConnectedByUserId: request.user.userId,
                instagramUserId: linkInstagram ? chosen.instagramUserId : null,
                instagramUsername: linkInstagram ? chosen.instagramUsername ?? null : null,
                instagramConnectedAt: linkInstagram ? now : null,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'channels.facebook_connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: {
                pageId: chosen.pageId,
                pageName: chosen.pageName,
                instagram: linkInstagram ? chosen.instagramUsername : null,
            },
            ipAddress: request.ip,
        });

        return {
            success: true,
            pageName: chosen.pageName,
            instagramUsername: linkInstagram ? chosen.instagramUsername ?? null : null,
        };
    });

    // POST /channels/facebook/disconnect
    fastify.post('/facebook/disconnect', { preHandler: [fastify.authenticate] }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can disconnect channels');
        }

        // Best effort on Meta's side: a failure there must never trap a tenant
        // in a connection they have asked to end.
        const outcome = await disconnectFacebookPage(fastify.prisma, request.user.tenantId, request.log);

        await audit({
            prisma: fastify.prisma,
            action: 'channels.facebook_disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { pageId: outcome.pageId, pageName: outcome.pageName, instagram: outcome.instagramUsername, metaCleanup: outcome.metaCleanup, by: 'owner' },
            ipAddress: request.ip,
        });

        return { success: true };
    });
};

export default channelRoutes;
