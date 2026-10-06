/**
 * Custom billing (A7): terms validation and the usage statement.
 *
 * A tenant on custom terms (BillingTerms) is charged
 *   setup fee (first period only) + monthly fee + units x unit price
 * where a "unit" is one DomainEvent of `unitEventType` (e.g. flow.completed).
 * Everything is integer minor units; the only multiplication is
 * count x unitPrice and it is checked against MAX_SAFE_INTEGER.
 *
 * The statement is computed live from the rows, not frozen: it always reflects
 * the CURRENT terms for the whole period. Changing a price mid-month re-prices
 * that month. There is no invoice snapshot table (no schema changes in A7).
 *
 * PERIODS are calendar months in the TENANT's timezone: [local 1st 00:00,
 * next local 1st 00:00), converted to UTC instants for the query.
 *
 * SETUP FEE "first period only": BillingTerms has no "setup billed" flag, so
 * the first period is the month (tenant timezone) that contains
 * BillingTerms.createdAt. createdAt is set once by the upsert and never
 * changes when terms are edited, so every statement for that month carries the
 * fee and no other month does: it is stateless, idempotent and can never be
 * charged twice. Consequences, deliberate: months BEFORE the terms existed bill
 * nothing; the first month's monthly fee is not prorated; usage in the first
 * month counts only events from the moment the terms existed (earlier events of
 * a fan-out-only type may not have been stored, so counting them would be
 * unreliable). Deleting and recreating the row would restart the clock; no
 * route deletes it.
 *
 * UNITS ARE COUNTED FROM WHEN THE UNIT TYPE WAS LAST SET. Fan-out-only events
 * (see events/publish.ts) are stored only while some subscriber, or this unit
 * type, wants them. Rows from before a tenant's unit type was set are therefore
 * an arbitrary subset, and counting them undercounts unpredictably. The start is
 * derived from the audit trail ('billing.terms.updated' carries before/after):
 * the most recent edit that moved unitEventType INTO its current value. No
 * schema change, and BillingTerms.updatedAt alone cannot do it (it moves on a
 * fee edit too, which would silently drop usage). With no such audit row
 * (terms written outside the admin route) it falls back to createdAt and the
 * statement says it may undercount. publish.ts caches the unit type for 30 s per
 * process, so events published in the 30 s after a change can still be missing:
 * the statement notes that too. The start is shown as `unitCountedFrom`.
 */

import { z } from 'zod';
import { isEventType } from './events/catalogue.js';
import { startOfDayInZone, zonedDateString } from './timezone.js';

export const BILLING_LIMITS = Object.freeze({
    /** Setup and monthly fee cap, minor units (1,000,000.00 major). */
    maxFeeMinor: 100_000_000,
    /** Per-unit price cap, minor units (10,000.00 major). */
    maxUnitPriceMinor: 1_000_000,
    maxNotesLength: 500,
});

const minor = (max: number) => z.number().int().min(0).max(max);

/** PUT body for a tenant's terms. Strict: unknown keys are a 400, not passed to Prisma. */
export const billingTermsSchema = z
    .object({
        currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter upper-case code, e.g. GHS'),
        setupFeeMinor: minor(BILLING_LIMITS.maxFeeMinor),
        monthlyFeeMinor: minor(BILLING_LIMITS.maxFeeMinor),
        unitPriceMinor: minor(BILLING_LIMITS.maxUnitPriceMinor),
        unitEventType: z
            .string()
            .refine(isEventType, 'unitEventType must be an event type from the catalogue')
            .nullable()
            .optional(),
        notes: z.string().max(BILLING_LIMITS.maxNotesLength).nullable().optional(),
    })
    .strict();

export type BillingTermsInput = z.infer<typeof billingTermsSchema>;

export interface StatementTerms {
    currency: string;
    setupFeeMinor: number;
    monthlyFeeMinor: number;
    unitPriceMinor: number;
    unitEventType: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface StatementLine {
    code: 'setup_fee' | 'monthly_fee' | 'usage';
    description: string;
    quantity: number;
    unitAmountMinor: number;
    amountMinor: number;
}

export interface Statement {
    tenantId: string;
    tenantName: string | null;
    period: { month: string; start: Date; end: Date; timezone: string };
    /** False while the month is still running (counts and totals can still grow). */
    isFinal: boolean;
    currency: string | null;
    terms: StatementTerms | null;
    unitEventType: string | null;
    unitCount: number;
    /** When counting of unitEventType began (null without a unit type); may fall inside the period. */
    unitCountedFrom: Date | null;
    setupFeeApplied: boolean;
    lines: StatementLine[];
    totalMinor: number;
    notes: string[];
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function assertMonth(month: string): void {
    if (typeof month !== 'string' || !MONTH_RE.test(month)) {
        throw new Error(`Invalid month "${String(month)}": expected YYYY-MM`);
    }
}

/** The YYYY-MM that `instant` falls in, in `timeZone`. */
export function currentMonthKey(instant: Date, timeZone: string): string {
    return zonedDateString(instant, timeZone).slice(0, 7);
}

function nextMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** [start, end) of a calendar month in `timeZone`, as UTC instants. */
export function monthBounds(month: string, timeZone: string): { start: Date; end: Date } {
    assertMonth(month);
    const start = startOfDayInZone(`${month}-01`, timeZone);
    const end = startOfDayInZone(`${nextMonth(month)}-01`, timeZone);
    if (!start || !end) throw new Error(`Cannot compute bounds for ${month} in ${timeZone}`);
    return { start, end };
}

/** Integer minor units to a 2-decimal string without float arithmetic. */
export function formatMinor(minorUnits: number): string {
    const whole = Math.trunc(minorUnits / 100);
    const frac = minorUnits - whole * 100;
    return `${whole}.${String(frac).padStart(2, '0')}`;
}

export type TermsPhase = 'before' | 'first' | 'later';

/** Where `month` sits relative to the month the terms were created in (tenant zone). */
export function termsPhase(terms: Pick<StatementTerms, 'createdAt'>, month: string, timeZone: string): TermsPhase {
    const first = currentMonthKey(terms.createdAt, timeZone);
    if (month < first) return 'before'; // YYYY-MM sorts lexicographically
    return month === first ? 'first' : 'later';
}

function safeMul(a: number, b: number): number {
    const p = a * b;
    if (!Number.isSafeInteger(p)) throw new Error('Statement amount would overflow a safe integer');
    return p;
}

export interface UnitCountingStart {
    from: Date;
    /** 'audit' = taken from the audit trail; 'terms_created' = no audit row, so creation time. */
    source: 'audit' | 'terms_created';
}

export interface TermsAuditRow {
    createdAt: Date;
    metadata: unknown;
}

function unitTypeIn(side: unknown): string | null | undefined {
    if (!side || typeof side !== 'object') return undefined; // absent (e.g. creation has no "before")
    const v = (side as { unitEventType?: unknown }).unitEventType;
    return typeof v === 'string' ? v : null;
}

/**
 * When the tenant's CURRENT unit type started being stored: the newest audit row
 * (pass them newest first) whose edit changed unitEventType into the current
 * value. Never earlier than the terms' creation.
 */
export function unitCountingStart(
    terms: Pick<StatementTerms, 'createdAt' | 'unitEventType'>,
    auditRows: ReadonlyArray<TermsAuditRow>,
): UnitCountingStart {
    for (const row of auditRows) {
        const meta = row.metadata as { before?: unknown; after?: unknown } | null;
        if (!meta || typeof meta !== 'object') continue;
        const after = unitTypeIn(meta.after);
        const before = unitTypeIn(meta.before);
        if (after === terms.unitEventType && before !== terms.unitEventType) {
            const from = row.createdAt.getTime() > terms.createdAt.getTime() ? row.createdAt : terms.createdAt;
            return { from, source: 'audit' };
        }
    }
    return { from: terms.createdAt, source: 'terms_created' };
}

/** 2026-04-10 12:00 UTC, for notes. */
function stamp(d: Date): string {
    return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export interface ComputeInput {
    tenantId: string;
    tenantName?: string | null;
    month: string;
    timezone: string;
    unitCount: number;
    terms: StatementTerms | null;
    /** From `unitCountingStart`; omitted = nothing known, no note. */
    unitCounting?: UnitCountingStart;
    now?: Date;
    notes?: string[];
}

/** Pure statement maths. `unitCount` is ignored unless the terms name a unit type. */
export function computeStatement(input: ComputeInput): Statement {
    const { start, end } = monthBounds(input.month, input.timezone);
    const now = input.now ?? new Date();
    const notes = [...(input.notes ?? [])];
    const terms = input.terms;
    const base = {
        tenantId: input.tenantId,
        tenantName: input.tenantName ?? null,
        period: { month: input.month, start, end, timezone: input.timezone },
        isFinal: now.getTime() >= end.getTime(),
        terms,
    };

    if (!terms) {
        notes.push('This organisation has no custom billing terms.');
        return { ...base, currency: null, unitEventType: null, unitCount: 0, unitCountedFrom: null, setupFeeApplied: false, lines: [], totalMinor: 0, notes };
    }

    const phase = termsPhase(terms, input.month, input.timezone);
    if (phase === 'before') {
        notes.push('This period is before the billing terms took effect; nothing is billed.');
        return { ...base, currency: terms.currency, unitEventType: terms.unitEventType, unitCount: 0, unitCountedFrom: null, setupFeeApplied: false, lines: [], totalMinor: 0, notes };
    }
    if (phase === 'first') {
        notes.push('First period: the monthly fee is not prorated and usage counts from when the terms took effect.');
    }

    const lines: StatementLine[] = [];
    const setupFeeApplied = phase === 'first' && terms.setupFeeMinor > 0;
    if (setupFeeApplied) {
        lines.push({ code: 'setup_fee', description: 'Setup fee', quantity: 1, unitAmountMinor: terms.setupFeeMinor, amountMinor: terms.setupFeeMinor });
    }
    if (terms.monthlyFeeMinor > 0) {
        lines.push({ code: 'monthly_fee', description: 'Monthly fee', quantity: 1, unitAmountMinor: terms.monthlyFeeMinor, amountMinor: terms.monthlyFeeMinor });
    }
    const unitCount = terms.unitEventType ? input.unitCount : 0;
    let unitCountedFrom: Date | null = null;
    if (terms.unitEventType && input.unitCounting) {
        unitCountedFrom = input.unitCounting.from;
        notes.push(`Units counted from ${stamp(unitCountedFrom)}${input.unitCounting.source === 'terms_created' ? ' (when the terms were created)' : ''}.`);
        if (input.unitCounting.source === 'terms_created') {
            notes.push('There is no record of when the unit type was set, so counting may have started later than shown and usage may be undercounted. Check it by hand.');
        }
        if (unitCountedFrom.getTime() > start.getTime()) {
            notes.push(unitCountedFrom.getTime() >= end.getTime()
                ? 'WARNING: counting began after this period ended, so no usage is counted for it.'
                : 'WARNING: counting began inside this period. Earlier usage in this period is not included.');
        }
    }
    if (terms.unitEventType) {
        notes.push('Events published within about 30 seconds of a change to the unit type may be missing (the setting is cached for 30 s per server).');
    }
    if (terms.unitEventType) {
        lines.push({
            code: 'usage',
            description: `Usage: ${terms.unitEventType}`,
            quantity: unitCount,
            unitAmountMinor: terms.unitPriceMinor,
            amountMinor: safeMul(unitCount, terms.unitPriceMinor),
        });
    }
    const totalMinor = lines.reduce((sum, l) => {
        const next = sum + l.amountMinor;
        if (!Number.isSafeInteger(next)) throw new Error('Statement total would overflow a safe integer');
        return next;
    }, 0);

    return { ...base, currency: terms.currency, unitEventType: terms.unitEventType, unitCount, unitCountedFrom, setupFeeApplied, lines, totalMinor, notes };
}

interface StatementPrisma {
    tenant: { findUnique: (args: any) => Promise<{ id: string; name: string; timezone: string | null } | null> };
    billingTerms: { findUnique: (args: any) => Promise<StatementTerms | null> };
    domainEvent: { count: (args: any) => Promise<number> };
    auditLog: { findMany: (args: any) => Promise<TermsAuditRow[]> };
}

/** Terms edits inspected, newest first. A tenant's terms are edited a handful of times. */
const AUDIT_LOOKBACK = 200;

function validZone(tz: string | null | undefined): tz is string {
    if (!tz) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/**
 * The statement for a tenant and month (default: the current month in the
 * tenant's timezone). Returns null for an unknown tenant; throws on a
 * malformed month.
 */
export async function getStatement(
    prisma: StatementPrisma,
    tenantId: string,
    month?: string,
    now: Date = new Date(),
): Promise<Statement | null> {
    if (month !== undefined) assertMonth(month);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, timezone: true } });
    if (!tenant) return null;

    const notes: string[] = [];
    let timezone = 'UTC';
    if (validZone(tenant.timezone)) {
        timezone = tenant.timezone;
    } else {
        notes.push(`The organisation's timezone "${tenant.timezone ?? ''}" is not valid; UTC was used for the month boundaries.`);
    }
    const period = month ?? currentMonthKey(now, timezone);

    const terms = await prisma.billingTerms.findUnique({ where: { tenantId } });
    let unitCount = 0;
    let unitCounting: UnitCountingStart | undefined;
    if (terms?.unitEventType) {
        const phase = termsPhase(terms, period, timezone);
        if (phase !== 'before') {
            const audit = await prisma.auditLog.findMany({
                where: { tenantId, action: 'billing.terms.updated', targetType: 'BillingTerms' },
                orderBy: { createdAt: 'desc' },
                take: AUDIT_LOOKBACK,
                select: { createdAt: true, metadata: true },
            });
            unitCounting = unitCountingStart(terms, audit);
            const { start, end } = monthBounds(period, timezone);
            const from = unitCounting.from.getTime() > start.getTime() ? unitCounting.from : start;
            if (from.getTime() < end.getTime()) {
                unitCount = await prisma.domainEvent.count({
                    where: { tenantId, type: terms.unitEventType, createdAt: { gte: from, lt: end } },
                });
            }
        }
    }
    return computeStatement({ tenantId, tenantName: tenant.name, month: period, timezone, unitCount, terms, unitCounting, now, notes });
}

function csvCell(value: string): string {
    // Neutralise spreadsheet formulas, then quote when needed.
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV (CRLF) of the line items and the total, amounts in major units. */
export function statementToCsv(statement: Statement): string {
    const cur = statement.currency ?? '';
    const rows: string[][] = [['description', 'quantity', 'unit_amount', 'amount', 'currency']];
    for (const l of statement.lines) {
        rows.push([csvCell(l.description), String(l.quantity), formatMinor(l.unitAmountMinor), formatMinor(l.amountMinor), cur]);
    }
    rows.push(['Total', '', '', formatMinor(statement.totalMinor), cur]);
    return rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}
