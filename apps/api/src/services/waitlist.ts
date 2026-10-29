/**
 * Waitlist: businesses asking to join while self sign-up is closed
 * (services/registration-gate.ts). Validation, the join itself, the admin
 * list/counts and invites live here; routes stay thin.
 *
 * Personal data: name, phone and email are needed to reach people and are
 * shown only in the admin console. They are never written to logs or the
 * audit trail in full (use maskEmail / maskPhone from contact-privacy).
 *
 * Invites: a random 256-bit token, handed out once inside a
 * /register?invite=<token> link. Only its SHA-256 is stored, so a database
 * read never yields a usable link. An invite works while the entry is
 * INVITED, unused and unexpired (14 days), for that entry's email only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, WaitlistEntry, WaitlistStatus } from '@prisma/client';
import { normalizeCustomerPhone } from './customer-phone.js';

export const WAITLIST_BUSINESS_TYPES = [
    'skin_clinic',
    'spa',
    'dental',
    'tailoring',
    'private_chef',
    'photography',
    'fitness',
    'car_detailing',
    'salon_barber',
    'boutique',
    'food',
    'other',
] as const;
export type WaitlistBusinessType = (typeof WAITLIST_BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABEL: Record<WaitlistBusinessType, string> = {
    skin_clinic: 'Skin clinic',
    spa: 'Spa',
    dental: 'Dental clinic',
    tailoring: 'Tailoring',
    private_chef: 'Private chef',
    photography: 'Photography',
    fitness: 'Fitness',
    car_detailing: 'Car detailing',
    salon_barber: 'Salon or barber',
    boutique: 'Boutique',
    food: 'Food',
    other: 'Other',
};

export const WAITLIST_STATUSES = ['NEW', 'CONTACTED', 'INVITED', 'JOINED', 'DECLINED'] as const satisfies readonly WaitlistStatus[];

export const INVITE_TTL_DAYS = 14;
const DAY_MS = 86_400_000;

/** Column sizes (schema.prisma). */
const MAX = { name: 120, businessName: 120, email: 254, city: 120, heardFrom: 120, message: 500, notes: 2000 } as const;

/** A Ghana number used only to say "a local 0... number is Ghanaian". */
const GHANA_REFERENCE_NUMBER = '+233200000000';

/** Any common spelling -> E.164. Local numbers are read as Ghana (+233). Null when it cannot be a number. */
export function normaliseWaitlistPhone(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const digits = trimmed.replace(/\D/g, '');
    // "244123456": a Ghana national number typed without its leading 0.
    if (!trimmed.startsWith('+') && /^[235]\d{8}$/.test(digits)) return `+233${digits}`;
    const e164 = normalizeCustomerPhone(trimmed, GHANA_REFERENCE_NUMBER);
    // A Ghana number has exactly nine national digits: refuse one digit short or long.
    if (e164?.startsWith('+233') && !/^\+233[235]\d{8}$/.test(e164)) return null;
    return e164;
}

/** "" and whitespace-only become undefined, so blank optional fields are not stored as "". */
const optionalText = (max: number) =>
    z
        .string()
        .max(max * 2)
        .optional()
        .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
        .refine((v) => v === undefined || v.length <= max, `Use at most ${max} characters.`);

const requiredText = (max: number, missing: string) => z.string().trim().min(2, missing).max(max, `Use at most ${max} characters.`);

export const waitlistJoinSchema = z.object({
    name: requiredText(MAX.name, 'Please tell us your name.'),
    businessName: requiredText(MAX.businessName, 'What is your business called?'),
    businessType: z.enum(WAITLIST_BUSINESS_TYPES, { errorMap: () => ({ message: 'Choose the kind of business.' }) }),
    phone: z
        .string()
        .max(40)
        .transform((v, ctx) => {
            const e164 = normaliseWaitlistPhone(v);
            if (!e164) {
                // Never echo the value back: error messages are logged.
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That WhatsApp number does not look right.' });
                return z.NEVER;
            }
            return e164;
        }),
    email: z.string().trim().toLowerCase().max(MAX.email, 'That email is too long.').email('That email does not look right.'),
    city: requiredText(MAX.city, 'Which town or area are you in?'),
    heardFrom: optionalText(MAX.heardFrom),
    message: optionalText(MAX.message),
    consent: z.literal(true, { errorMap: () => ({ message: 'Please agree so we can contact you.' }) }),
    /** Honeypot. Hidden from people and screen readers; bots fill it in. */
    website: z.string().max(500).optional(),
});

export type WaitlistJoinInput = z.infer<typeof waitlistJoinSchema>;
export type WaitlistJoinData = Omit<WaitlistJoinInput, 'website' | 'consent' | 'heardFrom' | 'message'> & {
    heardFrom?: string;
    message?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query<R> = (args?: any) => Promise<R>;

/**
 * Structural slice of the Prisma client the waitlist uses. Loose on purpose
 * (like services/alerts.ts): the tenant-guarded `$extends` client, the plain
 * client and a transaction client all fit, and the inputs are built here.
 */
export interface WaitlistDb {
    waitlistEntry: {
        findUnique: Query<WaitlistEntry | null>;
        findMany: Query<WaitlistEntry[]>;
        count: Query<number>;
        upsert: Query<WaitlistEntry>;
        update: Query<WaitlistEntry>;
        updateMany: Query<{ count: number }>;
        groupBy: Query<unknown>;
    };
}

/** An invite in these states is not overwritten by someone joining again with the same email. */
const LOCKED_ON_REJOIN: readonly WaitlistStatus[] = ['INVITED', 'JOINED'];

/**
 * Join, or update the existing entry for this email. The caller answers the
 * same way either way, so the form never reveals who is already listed.
 * An INVITED or JOINED entry is left as it is: its invite is bound to the
 * address and number the admin saw.
 */
export async function joinWaitlist(
    db: WaitlistDb,
    input: WaitlistJoinData,
    now: Date = new Date(),
): Promise<{ created: boolean; entry: WaitlistEntry }> {
    const email = input.email.trim().toLowerCase();
    const details = {
        name: input.name,
        businessName: input.businessName,
        businessType: input.businessType,
        phone: input.phone,
        city: input.city,
        heardFrom: input.heardFrom ?? null,
        message: input.message ?? null,
        consentAt: now,
    };
    const existing = await db.waitlistEntry.findUnique({ where: { email } });
    if (existing && LOCKED_ON_REJOIN.includes(existing.status)) return { created: false, entry: existing };
    // Native upsert (INSERT ... ON CONFLICT): two people racing on one email never fail.
    const entry = await db.waitlistEntry.upsert({
        where: { email },
        create: { email, ...details },
        update: details,
    });
    return { created: !existing, entry };
}

/* ------------------------------------------------------------------ */
/* Invites                                                             */
/* ------------------------------------------------------------------ */

export function hashInviteToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 random bytes, base64url (43 characters). Hand out `token`, store `hash`. */
export function newInviteToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashInviteToken(token) };
}

export function inviteLink(frontendUrl: string, token: string): string {
    return `${frontendUrl.replace(/\/+$/, '')}/register?invite=${encodeURIComponent(token)}`;
}

export type InviteState = 'valid' | 'expired' | 'used' | 'invalid';

export function inviteState(
    entry: Pick<WaitlistEntry, 'status' | 'inviteTokenHash' | 'inviteExpiresAt' | 'inviteUsedAt'> | null,
    now: Date,
): InviteState {
    if (!entry || !entry.inviteTokenHash) return 'invalid';
    if (entry.inviteUsedAt) return 'used';
    if (entry.status !== 'INVITED') return 'invalid';
    if (!entry.inviteExpiresAt || entry.inviteExpiresAt.getTime() <= now.getTime()) return 'expired';
    return 'valid';
}

export class WaitlistEntryNotFoundError extends Error {
    constructor() { super('Waitlist entry not found'); this.name = 'WaitlistEntryNotFoundError'; }
}
export class AlreadyJoinedError extends Error {
    constructor() { super('They have already joined'); this.name = 'AlreadyJoinedError'; }
}

/**
 * Make (or replace) the invite for an entry: a fresh token, valid 14 days.
 * The previous link stops working because its hash is overwritten.
 */
export async function createInvite(
    db: WaitlistDb,
    args: { id: string; adminId: string; now?: Date },
): Promise<{ token: string; expiresAt: Date; entry: WaitlistEntry; previousStatus: WaitlistStatus }> {
    const now = args.now ?? new Date();
    const current = await db.waitlistEntry.findUnique({ where: { id: args.id } });
    if (!current) throw new WaitlistEntryNotFoundError();
    if (current.status === 'JOINED' || current.inviteUsedAt) throw new AlreadyJoinedError();
    const { token, hash } = newInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    const entry = await db.waitlistEntry.update({
        where: { id: args.id },
        data: {
            status: 'INVITED',
            inviteTokenHash: hash,
            invitedAt: now,
            inviteExpiresAt: expiresAt,
            invitedByAdminId: args.adminId,
            inviteUsedAt: null,
        },
    });
    return { token, expiresAt, entry, previousStatus: current.status };
}

/* ------------------------------------------------------------------ */
/* Admin list and counts                                               */
/* ------------------------------------------------------------------ */

export const waitlistListQuerySchema = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(WAITLIST_STATUSES).optional(),
    businessType: z.enum(WAITLIST_BUSINESS_TYPES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type WaitlistListQuery = z.infer<typeof waitlistListQuerySchema>;

/** Filters only (no paging), so the CSV export can reuse them. */
export const waitlistFilterSchema = waitlistListQuerySchema.pick({ search: true, status: true, businessType: true });
export type WaitlistFilter = z.infer<typeof waitlistFilterSchema>;

export function buildWaitlistWhere(q: WaitlistFilter): Prisma.WaitlistEntryWhereInput {
    const and: Prisma.WaitlistEntryWhereInput[] = [];
    const search = q.search?.trim();
    if (search) {
        const or: Prisma.WaitlistEntryWhereInput[] = [
            { name: { contains: search, mode: 'insensitive' } },
            { businessName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search.toLowerCase(), mode: 'insensitive' } },
        ];
        // Phones are stored as +233XXXXXXXXX; match the national digits however they were typed.
        const digits = search.replace(/\D/g, '').replace(/^233/, '').replace(/^0/, '');
        if (digits.length >= 3) or.push({ phone: { contains: digits } });
        and.push({ OR: or });
    }
    if (q.status) and.push({ status: q.status });
    if (q.businessType) and.push({ businessType: q.businessType });
    return and.length ? { AND: and } : {};
}

/** A row for the admin console: every field, the invite state, never the token hash. */
export function adminView(entry: WaitlistEntry, now: Date = new Date()) {
    const { inviteTokenHash: _hash, ...rest } = entry;
    return { ...rest, inviteState: entry.inviteTokenHash ? inviteState(entry, now) : null };
}
export type WaitlistAdminView = ReturnType<typeof adminView>;

export async function listWaitlist(db: WaitlistDb, q: WaitlistListQuery): Promise<{ rows: WaitlistEntry[]; total: number }> {
    const where = buildWaitlistWhere(q);
    const [rows, total] = await Promise.all([
        db.waitlistEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
        db.waitlistEntry.count({ where }),
    ]);
    return { rows, total };
}

export interface WaitlistSummary {
    total: number;
    newThisWeek: number;
    byStatus: Record<WaitlistStatus, number>;
    byBusinessType: Record<string, number>;
}

export async function waitlistSummary(db: WaitlistDb, now: Date = new Date()): Promise<WaitlistSummary> {
    const since = new Date(now.getTime() - 7 * DAY_MS);
    const [total, newThisWeek, byStatusRows, byTypeRows] = await Promise.all([
        db.waitlistEntry.count(),
        db.waitlistEntry.count({ where: { createdAt: { gte: since } } }),
        db.waitlistEntry.groupBy({ by: ['status'], _count: { _all: true } }),
        db.waitlistEntry.groupBy({ by: ['businessType'], _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(WAITLIST_STATUSES.map((s) => [s, 0])) as Record<WaitlistStatus, number>;
    for (const r of byStatusRows as Array<{ status: WaitlistStatus; _count: { _all: number } }>) byStatus[r.status] = r._count._all;
    const byBusinessType: Record<string, number> = {};
    for (const r of byTypeRows as Array<{ businessType: string; _count: { _all: number } }>) byBusinessType[r.businessType] = r._count._all;
    return { total, newThisWeek, byStatus, byBusinessType };
}

/** Most rows one CSV export returns. The list is small; this only bounds a runaway. */
export const EXPORT_MAX_ROWS = 10_000;

export const WAITLIST_CSV_HEADER = [
    'created_at', 'name', 'business_name', 'business_type', 'phone', 'email', 'city', 'heard_from', 'message',
    'status', 'admin_notes', 'invited_at', 'invite_expires_at', 'joined_tenant_id', 'consent_at',
] as const;

export function waitlistCsvRow(e: WaitlistEntry) {
    return [
        e.createdAt, e.name, e.businessName, e.businessType, e.phone, e.email, e.city, e.heardFrom, e.message,
        e.status, e.adminNotes, e.invitedAt, e.inviteExpiresAt, e.joinedTenantId, e.consentAt,
    ];
}

export const waitlistUpdateSchema = z
    .object({
        status: z.enum(WAITLIST_STATUSES).optional(),
        adminNotes: z.string().max(MAX.notes).nullable().optional(),
    })
    .refine((b) => b.status !== undefined || b.adminNotes !== undefined, 'Nothing to change.');
