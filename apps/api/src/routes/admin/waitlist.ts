/**
 * Admin waitlist (mounted under /admin):
 *   GET    /waitlist              list: search, status, businessType, paging     waitlist:read
 *   GET    /waitlist/summary      total, new this week, by status, by type       waitlist:read
 *   GET    /waitlist/export.csv   CSV of the (filtered) list                     waitlist:export
 *   PATCH  /waitlist/:id          status and/or admin notes                      waitlist:write
 *   DELETE /waitlist/:id          remove the entry                               waitlist:write
 *   POST   /waitlist/:id/invite   one-time sign-up link (optionally emailed)     waitlist:write
 *
 * Audited: status changes, deletes, invites, exports. Audit rows carry ids,
 * statuses and a masked email, never a full email/phone, the invite link or
 * its hash. The link is returned to the admin once and never stored.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { config } from '../../config/index.js';
import { toCsv } from '../../lib/csv.js';
import { maskEmail } from '../../services/contact-privacy.js';
import { resolveGmailCreds, sendEmail } from '../../services/gmail-smtp.js';
import {
    AlreadyJoinedError,
    EXPORT_MAX_ROWS,
    WAITLIST_CSV_HEADER,
    WaitlistEntryNotFoundError,
    adminView,
    buildWaitlistWhere,
    createInvite,
    inviteLink,
    listWaitlist,
    waitlistCsvRow,
    waitlistFilterSchema,
    waitlistListQuerySchema,
    waitlistSummary,
    waitlistUpdateSchema,
} from '../../services/waitlist.js';
import { waitlistInviteEmail } from '../../services/waitlist-emails.js';
import { adminActor, adminGuard } from './guard.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const inviteBody = z.object({ sendEmail: z.boolean().default(false) });

type InviteEmailOutcome = { emailed: true } | { emailed: false; emailError?: 'email_not_configured' | 'send_failed' };

const adminWaitlistRoutes: FastifyPluginAsync = async (fastify) => {
    const findOr404 = async (id: string) => {
        const entry = await fastify.prisma.waitlistEntry.findUnique({ where: { id } });
        if (!entry) throw fastify.httpErrors.notFound('Not on the waitlist (it may have been deleted)');
        return entry;
    };

    fastify.get('/waitlist', { preHandler: adminGuard(fastify, 'waitlist:read') }, async (request) => {
        const query = waitlistListQuerySchema.parse(request.query);
        const { rows, total } = await listWaitlist(fastify.prisma, query);
        const now = new Date();
        return {
            data: rows.map((r) => adminView(r, now)),
            pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
        };
    });

    fastify.get('/waitlist/summary', { preHandler: adminGuard(fastify, 'waitlist:read') }, async () => ({
        data: await waitlistSummary(fastify.prisma),
    }));

    fastify.get('/waitlist/export.csv', { preHandler: adminGuard(fastify, 'waitlist:export') }, async (request, reply) => {
        const filter = waitlistFilterSchema.parse(request.query);
        const rows = await fastify.prisma.waitlistEntry.findMany({
            where: buildWaitlistWhere(filter),
            orderBy: { createdAt: 'desc' },
            take: EXPORT_MAX_ROWS,
        });
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'waitlist.exported',
            targetType: 'WaitlistEntry',
            metadata: { rows: rows.length, filter: { status: filter.status ?? null, businessType: filter.businessType ?? null, searched: !!filter.search } },
        });
        const day = new Date().toISOString().slice(0, 10);
        return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="bookly-waitlist-${day}.csv"`)
            .header('Cache-Control', 'no-store')
            .send(toCsv(WAITLIST_CSV_HEADER, rows.map(waitlistCsvRow)));
    });

    fastify.patch('/waitlist/:id', { preHandler: adminGuard(fastify, 'waitlist:write') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const body = waitlistUpdateSchema.parse(request.body ?? {});
        const before = await findOr404(id);
        const entry = await fastify.prisma.waitlistEntry.update({
            where: { id },
            data: {
                ...(body.status !== undefined && { status: body.status }),
                ...(body.adminNotes !== undefined && { adminNotes: body.adminNotes?.trim() || null }),
            },
        });
        if (body.status !== undefined && body.status !== before.status) {
            await audit({
                prisma: fastify.prisma,
                ...adminActor(request),
                action: 'waitlist.status_changed',
                targetType: 'WaitlistEntry',
                targetId: id,
                metadata: { from: before.status, to: body.status },
            });
        }
        return { data: adminView(entry) };
    });

    fastify.delete('/waitlist/:id', { preHandler: adminGuard(fastify, 'waitlist:write') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const entry = await findOr404(id);
        await fastify.prisma.waitlistEntry.delete({ where: { id } });
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'waitlist.deleted',
            targetType: 'WaitlistEntry',
            targetId: id,
            metadata: { email: maskEmail(entry.email), businessType: entry.businessType, status: entry.status },
        });
        return { success: true };
    });

    fastify.post('/waitlist/:id/invite', { preHandler: adminGuard(fastify, 'waitlist:write') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { sendEmail: wantsEmail } = inviteBody.parse(request.body ?? {});
        const actor = adminActor(request);

        let invite;
        try {
            invite = await createInvite(fastify.prisma, { id, adminId: actor.actorId });
        } catch (err) {
            if (err instanceof WaitlistEntryNotFoundError) throw fastify.httpErrors.notFound('Not on the waitlist (it may have been deleted)');
            if (err instanceof AlreadyJoinedError) throw fastify.httpErrors.conflict('They have already joined Bookly.');
            throw err;
        }
        const link = inviteLink(config.frontendUrl, invite.token);

        let outcome: InviteEmailOutcome = { emailed: false };
        if (wantsEmail) {
            const creds = resolveGmailCreds({ tenantGmailUser: null, tenantGmailAppPasswordEncrypted: null, tenantGmailFromName: null });
            if (!creds) {
                outcome = { emailed: false, emailError: 'email_not_configured' };
            } else {
                const mail = waitlistInviteEmail({
                    name: invite.entry.name, businessName: invite.entry.businessName, email: invite.entry.email,
                    link, expiresAt: invite.expiresAt,
                });
                const sent = await sendEmail({ ...creds, to: invite.entry.email, ...mail });
                outcome = sent.ok ? { emailed: true } : { emailed: false, emailError: 'send_failed' };
                if (!sent.ok) request.log.warn({ waitlistEntryId: id }, 'waitlist invite email failed to send');
            }
        }

        // Never the link or its hash: whoever holds the link can sign up.
        await audit({
            prisma: fastify.prisma,
            ...actor,
            action: 'waitlist.invited',
            targetType: 'WaitlistEntry',
            targetId: id,
            metadata: { from: invite.previousStatus, expiresAt: invite.expiresAt.toISOString(), emailed: outcome.emailed },
        });

        return { data: { link, expiresAt: invite.expiresAt.toISOString(), ...outcome, entry: adminView(invite.entry) } };
    });
};

export default adminWaitlistRoutes;
