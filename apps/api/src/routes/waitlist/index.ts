/**
 * Public waitlist (no login), mounted at /waitlist:
 *   POST /waitlist          join (or update your entry). Same answer either way.
 *   GET  /waitlist/invite   check an invite link before showing the sign-up form.
 *
 * No cookie or session is read here, so there is no ambient credential for a
 * cross-site request to ride on: like the other public routes, CSRF does not
 * apply (plugins/csrf.ts guards the cookie-authenticated routes). Abuse is
 * handled by a per-IP rate limit and a honeypot field.
 *
 * Logs carry the entry id and business type only, never the email or phone.
 */
import type { FastifyPluginAsync, FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { raiseAlert } from '../../services/alerts.js';
import { resolveGmailCreds, sendEmail } from '../../services/gmail-smtp.js';
import {
    BUSINESS_TYPE_LABEL,
    hashInviteToken,
    inviteState,
    joinWaitlist,
    waitlistJoinSchema,
    type WaitlistBusinessType,
} from '../../services/waitlist.js';
import { waitlistConfirmationEmail } from '../../services/waitlist-emails.js';

const perIp = (max: number, timeWindow: string, bucket: string) => ({
    rateLimit: { max, timeWindow, keyGenerator: (req: { ip: string }) => `${req.ip}:${bucket}` },
});

const inviteQuerySchema = z.object({ token: z.string().trim().min(1).max(200) });

/** The one body every join answers with: new, repeat or honeypot alike. */
const JOINED = { success: true } as const;

const waitlistRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/', { config: perIp(5, '1 hour', 'waitlist') }, async (request) => {
        const body = waitlistJoinSchema.parse(request.body);

        if (body.website?.trim()) {
            request.log.info('waitlist honeypot filled in; ignored');
            return JOINED;
        }

        const { created, entry } = await joinWaitlist(fastify.prisma, body);
        request.log.info({ waitlistEntryId: entry.id, businessType: entry.businessType, created }, 'waitlist join');

        if (created) {
            const type = BUSINESS_TYPE_LABEL[entry.businessType as WaitlistBusinessType] ?? entry.businessType;
            // One rolling alert: each join bumps its counter and reopens it once resolved.
            await raiseAlert(fastify.prisma, {
                kind: 'waitlist.joined',
                severity: 'info',
                message: `New on the waitlist: ${entry.businessName} (${type}, ${entry.city})`,
                context: { waitlistEntryId: entry.id, businessType: entry.businessType },
                dedupeKey: 'waitlist:joined',
            });
            // Not awaited: the answer must not depend on (or be slowed by) the mail server.
            void sendConfirmation(entry, request.log);
        }
        return JOINED;
    });

    fastify.get('/invite', { config: perIp(20, '15 minutes', 'waitlist-invite') }, async (request) => {
        const { token } = inviteQuerySchema.parse(request.query);
        const entry = await fastify.prisma.waitlistEntry.findUnique({ where: { inviteTokenHash: hashInviteToken(token) } });
        const status = inviteState(entry, new Date());
        if (status !== 'valid' || !entry) return { status };
        return {
            status,
            email: entry.email,
            name: entry.name,
            businessName: entry.businessName,
            expiresAt: entry.inviteExpiresAt!.toISOString(),
        };
    });
};

async function sendConfirmation(
    entry: { id: string; name: string; businessName: string; email: string },
    log: FastifyBaseLogger,
): Promise<void> {
    try {
        const creds = resolveGmailCreds({ tenantGmailUser: null, tenantGmailAppPasswordEncrypted: null, tenantGmailFromName: null });
        if (!creds) {
            log.warn({ waitlistEntryId: entry.id }, 'waitlist confirmation not sent: no platform email sender configured');
            return;
        }
        const mail = waitlistConfirmationEmail({ name: entry.name, businessName: entry.businessName });
        const result = await sendEmail({ ...creds, to: entry.email, ...mail });
        if (!result.ok) log.warn({ waitlistEntryId: entry.id }, 'waitlist confirmation email failed to send');
    } catch (err) {
        log.error({ waitlistEntryId: entry.id, errName: (err as Error)?.name }, 'waitlist confirmation email threw');
    }
}

export default waitlistRoutes;
