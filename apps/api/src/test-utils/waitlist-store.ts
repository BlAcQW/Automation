/**
 * In-memory stand-in for prisma.waitlistEntry, for route tests. Not shipped:
 * only imported by *.test.ts. Every method is a vi.fn so a test can inspect
 * the exact query; `rows` is the table. Filtering in findMany/count is NOT
 * emulated (the where-builder has its own unit tests and the real-database
 * suite checks it end to end).
 */
import { vi } from 'vitest';

export interface WaitlistRow {
    id: string;
    name: string;
    businessName: string;
    businessType: string;
    phone: string;
    email: string;
    city: string;
    heardFrom: string | null;
    message: string | null;
    status: 'NEW' | 'CONTACTED' | 'INVITED' | 'JOINED' | 'DECLINED';
    adminNotes: string | null;
    inviteTokenHash: string | null;
    invitedAt: Date | null;
    inviteExpiresAt: Date | null;
    invitedByAdminId: string | null;
    inviteUsedAt: Date | null;
    joinedTenantId: string | null;
    consentAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export function waitlistRow(over: Partial<WaitlistRow> = {}): WaitlistRow {
    const now = new Date('2026-10-20T10:00:00Z');
    return {
        id: 'w1', name: 'Ama Mensah', businessName: 'Glow Skin Clinic', businessType: 'skin_clinic',
        phone: '+233244123456', email: 'ama@glow.com', city: 'East Legon', heardFrom: null, message: null,
        status: 'NEW', adminNotes: null, inviteTokenHash: null, invitedAt: null, inviteExpiresAt: null,
        invitedByAdminId: null, inviteUsedAt: null, joinedTenantId: null, consentAt: now, createdAt: now, updatedAt: now,
        ...over,
    };
}

type Where = Record<string, unknown>;

function matches(row: WaitlistRow, where: Where): boolean {
    return Object.entries(where).every(([key, want]) => {
        const have = (row as unknown as Record<string, unknown>)[key];
        if (want === null) return have === null || have === undefined;
        if (want && typeof want === 'object' && !(want instanceof Date)) {
            const op = want as { gt?: Date; in?: unknown[]; not?: unknown };
            if (op.gt !== undefined) return have instanceof Date && have.getTime() > op.gt.getTime();
            if (op.in !== undefined) return op.in.includes(have);
            if ('not' in op) return have !== op.not;
            return false;
        }
        return have === want;
    });
}

function notFound(): Error {
    return Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
}

export function makeWaitlistStore(initial: WaitlistRow[] = []) {
    const rows = new Map<string, WaitlistRow>(initial.map((r) => [r.id, { ...r }]));
    let seq = rows.size;
    const find = (where: Where) => [...rows.values()].find((r) => matches(r, where)) ?? null;

    const create = vi.fn(async ({ data }: { data: Partial<WaitlistRow> }) => {
        seq += 1;
        const now = new Date();
        const row = waitlistRow({
            id: `w${seq}`, heardFrom: null, message: null, adminNotes: null, createdAt: now, updatedAt: now,
            ...(data as Partial<WaitlistRow>),
        });
        if (find({ email: row.email })) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        rows.set(row.id, row);
        return { ...row };
    });

    const update = vi.fn(async ({ where, data }: { where: Where; data: Partial<WaitlistRow> }) => {
        const row = find(where);
        if (!row) throw notFound();
        const next = { ...row, ...data, updatedAt: new Date() };
        rows.set(row.id, next);
        return { ...next };
    });

    const store = {
        rows,
        findUnique: vi.fn(async ({ where }: { where: Where }) => {
            const row = find(where);
            return row ? { ...row } : null;
        }),
        findFirst: vi.fn(async ({ where }: { where: Where }) => {
            const row = find(where ?? {});
            return row ? { ...row } : null;
        }),
        create,
        update,
        upsert: vi.fn(async ({ where, create: c, update: u }: { where: Where; create: Partial<WaitlistRow>; update: Partial<WaitlistRow> }) =>
            (find(where) ? update({ where, data: u }) : create({ data: c }))),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<WaitlistRow> }) => {
            let count = 0;
            for (const row of [...rows.values()]) {
                if (!matches(row, where)) continue;
                rows.set(row.id, { ...row, ...data, updatedAt: new Date() });
                count += 1;
            }
            return { count };
        }),
        delete: vi.fn(async ({ where }: { where: Where }) => {
            const row = find(where);
            if (!row) throw notFound();
            rows.delete(row.id);
            return { ...row };
        }),
        findMany: vi.fn(async (_args?: unknown) => [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({ ...r }))),
        count: vi.fn(async (_args?: unknown) => rows.size),
        groupBy: vi.fn(async (_args?: unknown) => [] as unknown[]),
    };
    return store;
}

export type WaitlistStore = ReturnType<typeof makeWaitlistStore>;
