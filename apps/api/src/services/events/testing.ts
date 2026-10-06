/** In-memory Prisma stand-in for the events tests (supports only what D3 uses). */
import { vi } from 'vitest';

type Row = Record<string, any>;

function cond(v: any, c: any): boolean {
    if (c === null) return v === null || v === undefined;
    if (c instanceof Date || typeof c !== 'object') return v instanceof Date && c instanceof Date ? v.getTime() === c.getTime() : v === c;
    if ('in' in c) return c.in.includes(v);
    if ('not' in c) return c.not === null ? v !== null && v !== undefined : v !== c.not;
    if ('has' in c) return Array.isArray(v) && v.includes(c.has);
    if ('none' in c) return true;
    if (v === null || v === undefined) return false;
    return (c.lt === undefined || v < c.lt) && (c.lte === undefined || v <= c.lte)
        && (c.gt === undefined || v > c.gt) && (c.gte === undefined || v >= c.gte);
}

export function matches(r: Row, w: Row = {}): boolean {
    return Object.entries(w).every(([k, c]) => {
        if (k === 'OR') return (c as Row[]).some((o) => matches(r, o));
        return cond(r[k], c);
    });
}

function pick(r: Row, select?: Row): Row {
    if (!select) return { ...r };
    return Object.fromEntries(Object.entries(select).filter(([, v]) => v).map(([k]) => [k, r[k]]));
}

function table(rows: Row[], defaults: () => Row) {
    let n = 0;
    const apply = (r: Row, data: Row) => {
        for (const [k, v] of Object.entries(data)) {
            r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] ?? 0) + v.increment
                : v && typeof v === 'object' && 'decrement' in v ? (r[k] ?? 0) - v.decrement : v;
        }
    };
    return {
        rows,
        create: vi.fn(async ({ data, select }: any) => {
            const r = { id: `${rows.length}-${++n}`, ...defaults(), ...data };
            rows.push(r);
            return pick(r, select);
        }),
        findMany: vi.fn(async ({ where, take, select }: any = {}) => rows.filter((r) => matches(r, where)).slice(0, take ?? 1e9).map((r) => pick(r, select))),
        findFirst: vi.fn(async ({ where, select }: any = {}) => {
            const r = rows.find((x) => matches(x, where));
            return r ? pick(r, select) : null;
        }),
        findUnique: vi.fn(async ({ where, select }: any) => {
            const r = rows.find((x) => matches(x, where));
            return r ? pick(r, select) : null;
        }),
        count: vi.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
        updateMany: vi.fn(async ({ where, data }: any) => {
            const hit = rows.filter((r) => matches(r, where));
            hit.forEach((r) => apply(r, data));
            return { count: hit.length };
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
            const hit = rows.filter((r) => matches(r, where));
            hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
            return { count: hit.length };
        }),
    };
}

export function fakeEventsPrisma(seed: { subs?: Row[]; deliveries?: Row[]; events?: Row[] } = {}) {
    const prisma: any = {
        webhookSubscription: table(seed.subs ?? [], () => ({ isActive: true, events: [], createdAt: new Date(), updatedAt: new Date(), description: null })),
        webhookDelivery: table(seed.deliveries ?? [], () => ({
            status: 'PENDING', attempts: 0, nextAttemptAt: null, claimedAt: null, lastStatusCode: null, lastError: null,
            createdAt: new Date(), deliveredAt: null,
        })),
        domainEvent: table(seed.events ?? [], () => ({ createdAt: new Date() })),
        platformAlert: { upsert: vi.fn(async () => ({})), update: vi.fn() },
        auditLog: { create: vi.fn(async () => ({})) },
    };
    prisma.$transaction = vi.fn(async (fn: any) => fn({ webhookSubscription: prisma.webhookSubscription, webhookDelivery: prisma.webhookDelivery, domainEvent: prisma.domainEvent }));
    return prisma;
}

export const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
