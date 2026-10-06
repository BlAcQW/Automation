/**
 * Platform-admin "create an organisation": tenant + OWNER user in one
 * transaction, then an invite (no password is ever set by the admin).
 *
 * The invite reuses the password-reset token (services/password-reset.ts):
 * the owner's stored hash is a random, unusable bcrypt hash, so the token
 * is single-use (it dies the moment they choose a password) and the
 * /reset-password page is the "accept invite" page.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PLAN_IDS } from './plans.js';
import { VERTICALS, verticalDefaults } from './verticals.js';
import { createResetToken, RESET_TOKEN_TTL_SECONDS } from './password-reset.js';
import { config } from '../config/index.js';

export const MAX_QUOTA_OVERRIDE = 1_000_000;
/** Invites outlive a reset link: the owner may not read mail within the hour. */
export const INVITE_TTL_DAYS = 7;
const DEFAULT_HOURS_DAYS = [1, 2, 3, 4, 5];

function isValidTimeZone(tz: string): boolean {
    if (!tz || tz.trim() !== tz) return false;
    // Intl also accepts fixed offsets ("+01:00") in newer Node; we store IANA names.
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

export const createTenantSchema = z
    .object({
        name: z.string().trim().min(2).max(120),
        timezone: z.string().refine(isValidTimeZone, 'Not a valid IANA timezone'),
        vertical: z.enum(VERTICALS),
        planId: z.enum(PLAN_IDS),
        monthlyMessageQuotaOverride: z.number().int().min(0).max(MAX_QUOTA_OVERRIDE).nullable().optional(),
        businessType: z.enum(['PRODUCT', 'SERVICE']).optional(),
        owner: z
            .object({
                name: z.string().trim().min(2).max(120),
                email: z.string().trim().toLowerCase().email().max(254),
            })
            .strict(),
    })
    .strict();

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export class DuplicateOwnerEmailError extends Error {
    constructor() {
        super('A user with this email already exists');
        this.name = 'DuplicateOwnerEmailError';
    }
}

export interface InviteMail {
    to: string;
    subject: string;
    text: string;
    html: string;
}

export interface InviteOutcome {
    sent: boolean;
    /** Present only when the email was NOT delivered; the admin must pass it on. */
    link?: string;
    reason?: 'email_not_configured' | 'send_failed';
}

export interface OnboardingDeps {
    // Structural: both the extended and plain Prisma clients fit.
    prisma: {
        user: { findFirst: (args: any) => Promise<unknown> };
        $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
    };
    secret: string;
    frontendUrl: string;
    now?: Date;
    emailConfigured: boolean;
    sendInvite: (mail: InviteMail) => Promise<{ ok: boolean; error?: string }>;
    productModeEnabled?: boolean;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function inviteEmail(args: { ownerName: string; orgName: string; link: string }): Omit<InviteMail, 'to'> {
    const first = args.ownerName.trim().split(' ')[0] || 'there';
    const subject = `You have been invited to manage ${args.orgName} on Bookly`;
    const text = [
        `Hi ${first},`,
        '',
        `An organisation called "${args.orgName}" has been set up for you on Bookly. Open this link to choose your password and sign in:`,
        '',
        args.link,
        '',
        `The link works for ${INVITE_TTL_DAYS} days and can only be used once. After that, use "Forgot password" on the sign-in page.`,
    ].join('\n');
    const orgH = escapeHtml(args.orgName);
    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A0F0D">
  <p style="font-size:16px">Hi ${escapeHtml(first)},</p>
  <p style="font-size:16px;line-height:1.5">An organisation called <strong>${orgH}</strong> has been set up for you on Bookly. Choose your password to sign in:</p>
  <p style="margin:28px 0">
    <a href="${escapeHtml(args.link)}" style="display:inline-block;background:#10B981;color:#050807;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px;font-size:16px">Accept invite</a>
  </p>
  <p style="font-size:14px;color:#5C6B65;line-height:1.5">The link works for ${INVITE_TTL_DAYS} days and can only be used once. After that, use "Forgot password" on the sign-in page.</p>
</div>`;
    return { subject, text, html };
}

export async function createTenantWithOwner(deps: OnboardingDeps, input: CreateTenantInput) {
    const now = deps.now ?? new Date();

    // Login resolves users by email alone, so an address may own one account.
    const taken = await deps.prisma.user.findFirst({ where: { email: input.owner.email }, select: { id: true } });
    if (taken) throw new DuplicateOwnerEmailError();

    // Unusable password: a real bcrypt hash of a secret nobody ever sees.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    const productMode = deps.productModeEnabled ?? config.featureFlags.productMode;
    const businessType =
        input.vertical === 'APPOINTMENTS' && productMode && input.businessType ? input.businessType : 'SERVICE';

    let created: { tenant: any; user: any };
    try {
        created = await deps.prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    ...verticalDefaults(input.vertical),
                    name: input.name,
                    vertical: input.vertical,
                    businessType,
                    timezone: input.timezone,
                    planId: input.planId,
                    monthlyMessageQuotaOverride: input.monthlyMessageQuotaOverride ?? null,
                    // Same as self-registration: quota cycle anchored at creation.
                    quotaCycleStart: now,
                } satisfies Prisma.TenantUncheckedCreateInput,
            });
            const user = await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    email: input.owner.email,
                    passwordHash,
                    name: input.owner.name,
                    role: 'OWNER',
                },
            });
            // Salon working hours only make sense for appointments.
            if (input.vertical === 'APPOINTMENTS') {
                await tx.workingHours.createMany({
                    data: DEFAULT_HOURS_DAYS.map((day) => ({
                        tenantId: tenant.id,
                        dayOfWeek: day,
                        startTime: '09:00',
                        endTime: '17:00',
                    })),
                });
            }
            return { tenant, user };
        });
    } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') throw new DuplicateOwnerEmailError();
        throw err;
    }

    // createResetToken fixes the TTL at one hour; shift `now` so it expires
    // INVITE_TTL_DAYS from now instead.
    const issuedAt = now.getTime() + INVITE_TTL_DAYS * 86_400_000 - RESET_TOKEN_TTL_SECONDS * 1000;
    const token = createResetToken({ id: created.user.id, passwordHash }, deps.secret, issuedAt);
    const link = `${deps.frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

    let invite: InviteOutcome;
    if (!deps.emailConfigured) {
        invite = { sent: false, link, reason: 'email_not_configured' };
    } else {
        const mail = inviteEmail({ ownerName: input.owner.name, orgName: input.name, link });
        try {
            const res = await deps.sendInvite({ to: input.owner.email, ...mail });
            invite = res.ok ? { sent: true } : { sent: false, link, reason: 'send_failed' };
        } catch {
            invite = { sent: false, link, reason: 'send_failed' };
        }
    }

    return { tenant: created.tenant, owner: created.user, invite };
}
