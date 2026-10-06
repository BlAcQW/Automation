import { describe, expect, it, vi } from 'vitest';
import {
    BILLING_LIMITS,
    billingTermsSchema,
    computeStatement,
    currentMonthKey,
    formatMinor,
    getStatement,
    monthBounds,
    statementToCsv,
    unitCountingStart,
    type StatementTerms,
} from './billing-usage.js';

const terms = (over: Partial<StatementTerms> = {}): StatementTerms => ({
    currency: 'GHS',
    setupFeeMinor: 0,
    monthlyFeeMinor: 0,
    unitPriceMinor: 0,
    unitEventType: null,
    notes: null,
    createdAt: new Date('2026-01-10T09:00:00Z'),
    updatedAt: new Date('2026-01-10T09:00:00Z'),
    ...over,
});

describe('billingTermsSchema', () => {
    const ok = { currency: 'GHS', setupFeeMinor: 0, monthlyFeeMinor: 50000, unitPriceMinor: 25, unitEventType: 'flow.completed' };

    it('accepts valid terms and null/absent unit type', () => {
        expect(billingTermsSchema.safeParse(ok).success).toBe(true);
        expect(billingTermsSchema.safeParse({ ...ok, unitEventType: null }).success).toBe(true);
        expect(billingTermsSchema.safeParse({ currency: 'GHS', setupFeeMinor: 0, monthlyFeeMinor: 0, unitPriceMinor: 0 }).success).toBe(true);
    });
    it('rejects non-integer, negative, non-numeric and non-finite money', () => {
        for (const field of ['setupFeeMinor', 'monthlyFeeMinor', 'unitPriceMinor']) {
            for (const v of [1.5, -1, '10', Number.NaN, Infinity, null]) {
                expect(billingTermsSchema.safeParse({ ...ok, [field]: v }).success, `${field}=${String(v)}`).toBe(false);
            }
        }
    });
    it('enforces the caps (inclusive) per field', () => {
        expect(billingTermsSchema.safeParse({ ...ok, setupFeeMinor: BILLING_LIMITS.maxFeeMinor }).success).toBe(true);
        expect(billingTermsSchema.safeParse({ ...ok, setupFeeMinor: BILLING_LIMITS.maxFeeMinor + 1 }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, monthlyFeeMinor: BILLING_LIMITS.maxFeeMinor + 1 }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, unitPriceMinor: BILLING_LIMITS.maxUnitPriceMinor }).success).toBe(true);
        expect(billingTermsSchema.safeParse({ ...ok, unitPriceMinor: BILLING_LIMITS.maxUnitPriceMinor + 1 }).success).toBe(false);
    });
    it('requires a 3-letter upper-case currency', () => {
        for (const c of ['ghs', 'GH', 'GHSS', '', 'G1S', 123, null]) {
            expect(billingTermsSchema.safeParse({ ...ok, currency: c }).success, String(c)).toBe(false);
        }
    });
    it('only accepts a unit type that is in the event catalogue', () => {
        expect(billingTermsSchema.safeParse({ ...ok, unitEventType: 'made.up' }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, unitEventType: 'webhook.test' }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, unitEventType: '*' }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, unitEventType: 'payment.succeeded' }).success).toBe(true);
    });
    it('rejects unknown keys (mass assignment) and over-long notes', () => {
        expect(billingTermsSchema.safeParse({ ...ok, tenantId: 'other' }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, notes: 'x'.repeat(BILLING_LIMITS.maxNotesLength + 1) }).success).toBe(false);
        expect(billingTermsSchema.safeParse({ ...ok, notes: 'ok' }).success).toBe(true);
    });
});

describe('monthBounds / currentMonthKey (tenant timezone)', () => {
    it('UTC month is [1st 00:00, next 1st 00:00)', () => {
        const b = monthBounds('2026-02', 'UTC');
        expect(b.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
        expect(b.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });
    it('rolls December into the next year', () => {
        expect(monthBounds('2026-12', 'UTC').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });
    it('uses the tenant zone, east and west of UTC', () => {
        expect(monthBounds('2026-04', 'Pacific/Auckland').start.toISOString()).toBe('2026-03-31T11:00:00.000Z'); // NZDT +13
        expect(monthBounds('2026-04', 'America/New_York').start.toISOString()).toBe('2026-04-01T04:00:00.000Z'); // EDT -4
    });
    it('currentMonthKey is the month in the tenant zone, not UTC', () => {
        const instant = new Date('2026-03-31T23:30:00Z');
        expect(currentMonthKey(instant, 'UTC')).toBe('2026-03');
        expect(currentMonthKey(instant, 'Africa/Accra')).toBe('2026-03');
        expect(currentMonthKey(instant, 'Pacific/Auckland')).toBe('2026-04');
    });
});

describe('formatMinor', () => {
    it('formats integer minor units to 2 decimals with no float maths', () => {
        expect(formatMinor(0)).toBe('0.00');
        expect(formatMinor(5)).toBe('0.05');
        expect(formatMinor(100)).toBe('1.00');
        expect(formatMinor(123456789)).toBe('1234567.89');
    });
});

describe('computeStatement maths', () => {
    const base = { tenantId: 't1', month: '2026-03', timezone: 'UTC', unitCount: 0 };
    const march = (o: Partial<StatementTerms>) => terms({ createdAt: new Date('2026-01-10T00:00:00Z'), ...o });

    it('later period: monthly fee + units x unit price in integer minor units', () => {
        const s = computeStatement({ ...base, unitCount: 1234, terms: march({ monthlyFeeMinor: 50_000, unitPriceMinor: 7, unitEventType: 'flow.completed' }) });
        expect(s.lines.map((l) => [l.code, l.quantity, l.unitAmountMinor, l.amountMinor])).toEqual([
            ['monthly_fee', 1, 50_000, 50_000],
            ['usage', 1234, 7, 8_638],
        ]);
        expect(s.totalMinor).toBe(58_638);
        expect(s.currency).toBe('GHS');
        expect(s.setupFeeApplied).toBe(false);
    });
    it('zero units still shows the usage line at 0 and bills only the monthly fee', () => {
        const s = computeStatement({ ...base, unitCount: 0, terms: march({ monthlyFeeMinor: 1000, unitPriceMinor: 50, unitEventType: 'flow.completed' }) });
        expect(s.lines.find((l) => l.code === 'usage')).toMatchObject({ quantity: 0, amountMinor: 0 });
        expect(s.totalMinor).toBe(1000);
    });
    it('no unit event type: no usage line and the count is ignored', () => {
        const s = computeStatement({ ...base, unitCount: 99, terms: march({ monthlyFeeMinor: 1000, unitPriceMinor: 50 }) });
        expect(s.lines.map((l) => l.code)).toEqual(['monthly_fee']);
        expect(s.unitCount).toBe(0);
    });
    it('all-zero terms produce an empty statement totalling 0', () => {
        const s = computeStatement({ ...base, terms: march({}) });
        expect(s.lines).toEqual([]);
        expect(s.totalMinor).toBe(0);
    });
    it('first period (the month the terms were created) adds the setup fee once', () => {
        const t = terms({ setupFeeMinor: 200_000, monthlyFeeMinor: 10_000, createdAt: new Date('2026-03-15T12:00:00Z') });
        const first = computeStatement({ ...base, month: '2026-03', terms: t });
        expect(first.lines.map((l) => l.code)).toEqual(['setup_fee', 'monthly_fee']);
        expect(first.totalMinor).toBe(210_000);
        expect(first.setupFeeApplied).toBe(true);
        const second = computeStatement({ ...base, month: '2026-04', terms: t });
        expect(second.lines.map((l) => l.code)).toEqual(['monthly_fee']);
        expect(second.totalMinor).toBe(10_000);
    });
    it('a period before the terms existed bills nothing and says why', () => {
        const t = terms({ setupFeeMinor: 200_000, monthlyFeeMinor: 10_000, createdAt: new Date('2026-03-15T12:00:00Z') });
        const s = computeStatement({ ...base, month: '2026-02', unitCount: 5, terms: t });
        expect(s.lines).toEqual([]);
        expect(s.totalMinor).toBe(0);
        expect(s.notes.join(' ')).toMatch(/before/i);
    });
    it('decides "first period" in the tenant timezone, not UTC', () => {
        // 2026-03-31T23:30Z is already April in Auckland.
        const t = terms({ setupFeeMinor: 100, createdAt: new Date('2026-03-31T23:30:00Z') });
        expect(computeStatement({ ...base, month: '2026-04', timezone: 'Pacific/Auckland', terms: t }).setupFeeApplied).toBe(true);
        expect(computeStatement({ ...base, month: '2026-03', timezone: 'Pacific/Auckland', terms: t }).lines).toEqual([]);
        expect(computeStatement({ ...base, month: '2026-03', timezone: 'UTC', terms: t }).setupFeeApplied).toBe(true);
    });
    it('no terms: empty statement with null currency', () => {
        const s = computeStatement({ ...base, terms: null });
        expect(s.terms).toBeNull();
        expect(s.currency).toBeNull();
        expect(s.totalMinor).toBe(0);
        expect(s.lines).toEqual([]);
    });
    it('refuses to produce an unsafe (overflowing) amount instead of rounding silently', () => {
        expect(() => computeStatement({
            ...base, unitCount: Number.MAX_SAFE_INTEGER, terms: march({ unitPriceMinor: 1_000_000, unitEventType: 'flow.completed' }),
        })).toThrow(/overflow|safe/i);
    });
    it('marks an in-progress month as not final', () => {
        const now = new Date('2026-03-10T00:00:00Z');
        expect(computeStatement({ ...base, now, terms: march({}) }).isFinal).toBe(false);
        expect(computeStatement({ ...base, now: new Date('2026-04-01T00:00:00Z'), terms: march({}) }).isFinal).toBe(true);
    });
    it('does not mutate its input terms', () => {
        const t = Object.freeze(march({ monthlyFeeMinor: 5 }));
        expect(() => computeStatement({ ...base, terms: t })).not.toThrow();
    });
});

const mkPrisma = (o: { terms?: any; tz?: string | null; count?: number; audit?: any[] } = {}) => ({
    auditLog: { findMany: vi.fn(async (_a?: any) => o.audit ?? []) },
    tenant: { findUnique: vi.fn(async (_a?: any): Promise<any> => ({ id: 't1', name: 'Acme', timezone: o.tz === undefined ? 'Pacific/Auckland' : o.tz })) },
    billingTerms: { findUnique: vi.fn(async (_a?: any) => o.terms ?? null) },
    domainEvent: { count: vi.fn(async (_a?: any) => o.count ?? 0) },
});

describe('getStatement (database reads)', () => {

    it('counts the unit event type for the tenant within the zoned month boundaries', async () => {
        const prisma = mkPrisma({ terms: terms({ unitEventType: 'flow.completed', unitPriceMinor: 10, createdAt: new Date('2026-01-01T00:00:00Z') }), count: 42 });
        const s = await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        const where = prisma.domainEvent.count.mock.calls[0][0].where;
        expect(where.tenantId).toBe('t1');
        expect(where.type).toBe('flow.completed');
        expect(where.createdAt.gte.toISOString()).toBe('2026-03-31T11:00:00.000Z');
        expect(where.createdAt.lt.toISOString()).toBe('2026-04-30T12:00:00.000Z'); // NZST +12 from 5 Apr
        expect(s!.unitCount).toBe(42);
        expect(s!.totalMinor).toBe(420);
    });
    it('in the first period only counts events from when the terms took effect', async () => {
        const createdAt = new Date('2026-04-10T00:00:00Z');
        const prisma = mkPrisma({ terms: terms({ unitEventType: 'flow.completed', createdAt }), tz: 'UTC' });
        await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        expect(prisma.domainEvent.count.mock.calls[0][0].where.createdAt.gte).toEqual(createdAt);
    });
    it('does not query events when there is no unit type or no terms', async () => {
        const a = mkPrisma({ terms: terms() });
        await getStatement(a as any, 't1', '2026-04');
        const b = mkPrisma();
        await getStatement(b as any, 't1', '2026-04');
        expect(a.domainEvent.count).not.toHaveBeenCalled();
        expect(b.domainEvent.count).not.toHaveBeenCalled();
    });
    it('defaults to the current month in the tenant zone', async () => {
        const prisma = mkPrisma({ terms: terms({ createdAt: new Date('2026-01-01T00:00:00Z') }) });
        const s = await getStatement(prisma as any, 't1', undefined, new Date('2026-03-31T23:30:00Z'));
        expect(s!.period.month).toBe('2026-04'); // Auckland
    });
    it('falls back to UTC with a note when the stored timezone is invalid', async () => {
        const prisma = mkPrisma({ terms: terms(), tz: 'Not/AZone' });
        const s = await getStatement(prisma as any, 't1', '2026-04');
        expect(s!.period.timezone).toBe('UTC');
        expect(s!.notes.join(' ')).toMatch(/timezone/i);
    });
    it('returns null for an unknown tenant', async () => {
        const prisma = mkPrisma();
        prisma.tenant.findUnique.mockResolvedValueOnce(null);
        expect(await getStatement(prisma as any, 'nope', '2026-04')).toBeNull();
    });
    it('rejects a malformed month', async () => {
        await expect(getStatement(mkPrisma() as any, 't1', '2026-13')).rejects.toThrow(/month/i);
        await expect(getStatement(mkPrisma() as any, 't1', 'March')).rejects.toThrow(/month/i);
    });
});

describe('statementToCsv', () => {
    const stmt = () => computeStatement({
        tenantId: 't1', tenantName: 'Acme, "Ltd"', month: '2026-03', timezone: 'UTC', unitCount: 3,
        terms: terms({ monthlyFeeMinor: 1050, unitPriceMinor: 25, unitEventType: 'flow.completed' }),
    });
    it('writes a header, line items and a total in major units', () => {
        const lines = statementToCsv(stmt()).trimEnd().split('\r\n');
        expect(lines[0]).toBe('description,quantity,unit_amount,amount,currency');
        expect(lines.at(-1)).toBe('Total,,,11.25,GHS');
        expect(lines).toContain('Monthly fee,1,10.50,10.50,GHS');
    });
    it('quotes cells and neutralises spreadsheet formulas', () => {
        const s = stmt();
        const evil = { ...s, lines: [{ ...s.lines[0], description: '=HYPERLINK("x")' }] };
        expect(statementToCsv(evil as any)).toContain(`"'=HYPERLINK(""x"")"`);
    });
    it('handles a statement with no terms', () => {
        const csv = statementToCsv(computeStatement({ tenantId: 't1', month: '2026-03', timezone: 'UTC', unitCount: 0, terms: null }));
        expect(csv.trimEnd().split('\r\n').at(-1)).toBe('Total,,,0.00,');
    });
});

describe('unitCountingStart (when the CURRENT unit type started being stored)', () => {
    const row = (at: string, before: string | null | undefined, after: string | null) => ({
        createdAt: new Date(at),
        metadata: { before: before === undefined ? null : { unitEventType: before }, after: { unitEventType: after } },
    });
    const t = terms({ unitEventType: 'flow.completed', createdAt: new Date('2026-01-10T09:00:00Z') });

    it('is the most recent edit that CHANGED the unit type into the current one (rows newest first)', () => {
        const r = unitCountingStart(t, [
            row('2026-05-01T00:00:00Z', 'flow.completed', 'flow.completed'), // fee edit only
            row('2026-04-01T00:00:00Z', null, 'flow.completed'),             // the change
            row('2026-02-01T00:00:00Z', null, null),
        ]);
        expect(r).toEqual({ from: new Date('2026-04-01T00:00:00Z'), source: 'audit' });
    });
    it('a terms creation that already had the unit type counts from creation', () => {
        const r = unitCountingStart(t, [row('2026-01-10T09:00:00Z', undefined, 'flow.completed')]);
        expect(r).toEqual({ from: new Date('2026-01-10T09:00:00Z'), source: 'audit' });
    });
    it('switched away and back: counts from the LAST switch in', () => {
        const r = unitCountingStart(t, [
            row('2026-06-01T00:00:00Z', 'other.type', 'flow.completed'),
            row('2026-05-01T00:00:00Z', 'flow.completed', 'other.type'),
            row('2026-04-01T00:00:00Z', null, 'flow.completed'),
        ]);
        expect(r.from).toEqual(new Date('2026-06-01T00:00:00Z'));
    });
    it('no audit record: falls back to terms creation and says so', () => {
        expect(unitCountingStart(t, [])).toEqual({ from: t.createdAt, source: 'terms_created' });
    });
    it('ignores malformed metadata rows', () => {
        const r = unitCountingStart(t, [{ createdAt: new Date('2026-05-01T00:00:00Z'), metadata: 'junk' } as any]);
        expect(r.source).toBe('terms_created');
    });
    it('never starts before the terms existed', () => {
        const r = unitCountingStart(t, [row('2025-01-01T00:00:00Z', null, 'flow.completed')]);
        expect(r.from).toEqual(t.createdAt);
    });
});

describe('statement anchoring of unit counts', () => {
    it('counts from the unit-type change inside the period, not the period start, and warns', async () => {
        const prisma = mkPrisma({
            terms: terms({ unitEventType: 'flow.completed', createdAt: new Date('2026-01-01T00:00:00Z') }), tz: 'UTC', count: 7,
            audit: [{ createdAt: new Date('2026-04-10T12:00:00Z'), metadata: { before: { unitEventType: null }, after: { unitEventType: 'flow.completed' } } }],
        });
        const s = await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        expect(prisma.domainEvent.count.mock.calls[0][0].where.createdAt.gte).toEqual(new Date('2026-04-10T12:00:00Z'));
        expect(s!.unitCountedFrom).toEqual(new Date('2026-04-10T12:00:00Z'));
        const notes = s!.notes.join(' | ');
        expect(notes).toMatch(/units counted from 2026-04-10 12:00 UTC/i);
        expect(notes).toMatch(/earlier .* not (counted|included)/i);
        expect(notes).toMatch(/30 s|30 seconds/i);
    });
    it('a unit type set before the period counts the whole month, no inside-period warning', async () => {
        const prisma = mkPrisma({
            terms: terms({ unitEventType: 'flow.completed', createdAt: new Date('2026-01-01T00:00:00Z') }), tz: 'UTC', count: 3,
            audit: [{ createdAt: new Date('2026-02-10T12:00:00Z'), metadata: { before: null, after: { unitEventType: 'flow.completed' } } }],
        });
        const s = await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        expect(prisma.domainEvent.count.mock.calls[0][0].where.createdAt.gte).toEqual(new Date('2026-04-01T00:00:00Z'));
        expect(s!.notes.join(' ')).not.toMatch(/earlier .* not (counted|included)/i);
    });
    it('a period that ended before counting began has zero units and no count query', async () => {
        const prisma = mkPrisma({
            terms: terms({ unitEventType: 'flow.completed', createdAt: new Date('2026-01-01T00:00:00Z') }), tz: 'UTC', count: 99,
            audit: [{ createdAt: new Date('2026-05-10T12:00:00Z'), metadata: { before: null, after: { unitEventType: 'flow.completed' } } }],
        });
        const s = await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        expect(prisma.domainEvent.count).not.toHaveBeenCalled();
        expect(s!.unitCount).toBe(0);
        expect(s!.notes.join(' ')).toMatch(/2026-05-10/);
    });
    it('without an audit record it falls back to creation and warns that it may undercount', async () => {
        const prisma = mkPrisma({ terms: terms({ unitEventType: 'flow.completed', createdAt: new Date('2026-01-01T00:00:00Z') }), tz: 'UTC' });
        const s = await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        expect(s!.notes.join(' ')).toMatch(/no record of when the unit type was set/i);
    });
    it('queries only this tenant\'s terms audit trail', async () => {
        const prisma = mkPrisma({ terms: terms({ unitEventType: 'flow.completed' }), tz: 'UTC' });
        await getStatement(prisma as any, 't1', '2026-04', new Date('2026-06-01T00:00:00Z'));
        expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({
            where: { tenantId: 't1', action: 'billing.terms.updated' }, orderBy: { createdAt: 'desc' },
        });
    });
    it('no unit type: no audit query, no counting note', async () => {
        const prisma = mkPrisma({ terms: terms(), tz: 'UTC' });
        const s = await getStatement(prisma as any, 't1', '2026-04');
        expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
        expect(s!.unitCountedFrom).toBeNull();
    });
});
