import { describe, it, expect } from 'vitest';
import { backfillCustomers } from './backfill-customers.js';

type Rec = Record<string, any>;

function matches(row: Rec, where: Rec): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (k === 'id' && v && typeof v === 'object') {
            if ('gt' in v) return row.id > v.gt;
            if ('in' in v) return v.in.includes(row.id);
        }
        if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
        if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
        return row[k] === v;
    });
}

function fake(seed: { tenants: Rec[]; conversation?: Rec[]; booking?: Rec[]; order?: Rec[]; customer?: Rec[] }) {
    const store = {
        tenant: seed.tenants,
        conversation: seed.conversation ?? [],
        booking: seed.booking ?? [],
        order: seed.order ?? [],
        customer: seed.customer ?? [],
    };
    let seq = 0;
    const writes = { create: 0, update: 0, updateMany: 0 };
    const model = (name: 'conversation' | 'booking' | 'order') => ({
        findMany: async ({ where, take, orderBy }: Rec) => {
            const rows = store[name].filter((r) => matches(r, where)).sort((a, b) => (a.id < b.id ? -1 : 1));
            return rows.slice(0, take);
        },
        updateMany: async ({ where, data }: Rec) => {
            const hit = store[name].filter((r) => matches(r, where));
            hit.forEach((r) => Object.assign(r, data));
            writes.updateMany += 1;
            return { count: hit.length };
        },
    });
    const prisma = {
        store,
        writes,
        tenant: {
            findMany: async ({ where, take }: Rec) =>
                store.tenant.filter((t) => matches(t, where ?? {})).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, take),
        },
        conversation: model('conversation'),
        booking: model('booking'),
        order: model('order'),
        customer: {
            findUnique: async ({ where }: Rec) => {
                const k = where.tenantId_phone;
                return store.customer.find((c) => c.tenantId === k.tenantId && c.phone === k.phone) ?? null;
            },
            create: async ({ data }: Rec) => {
                writes.create += 1;
                const row = { id: `c${++seq}`, name: null, email: null, ...data };
                store.customer.push(row);
                return row;
            },
            update: async ({ where, data }: Rec) => {
                writes.update += 1;
                const r = store.customer.find((c) => c.id === where.id)!;
                Object.assign(r, data);
                return r;
            },
        },
    };
    return prisma;
}

const quiet = { log: () => undefined };

function seed() {
    return fake({
        tenants: [
            { id: 't1', whatsappDisplayNumber: '+233200000000' },
            { id: 't2', whatsappDisplayNumber: null },
        ],
        conversation: [
            { id: 'cv1', tenantId: 't1', customerPhone: '+233241234567', customerName: 'Ama', customerId: null },
            { id: 'cv2', tenantId: 't1', customerPhone: null, customerName: 'Insta', customerId: null },
        ],
        booking: [
            { id: 'b1', tenantId: 't1', customerPhone: '0241234567', customerName: 'Ama M', customerEmail: 'a@x.com', customerId: null },
            { id: 'b2', tenantId: 't1', customerPhone: 'garbage', customerName: 'Bad', customerEmail: null, customerId: null },
            { id: 'b3', tenantId: 't2', customerPhone: '+233241234567', customerName: 'Other tenant', customerEmail: null, customerId: null },
            { id: 'b4', tenantId: 't2', customerPhone: '0241234567', customerName: 'Local no cc', customerEmail: null, customerId: null },
        ],
        order: [
            { id: 'o1', tenantId: 't1', customerPhone: '+233209999999', customerName: 'Kofi', customerId: null },
            { id: 'o2', tenantId: 't1', customerPhone: '+233209999999', customerName: 'Kofi', customerId: 'already' },
        ],
    });
}

describe('backfillCustomers', () => {
    it('creates one customer per distinct normalisable phone and links the rows, per tenant', async () => {
        const db = seed();
        const report = await backfillCustomers(db as any, { ...quiet, batchSize: 2 });

        const t1 = db.store.customer.filter((c) => c.tenantId === 't1');
        expect(t1.map((c) => c.phone).sort()).toEqual(['+233209999999', '+233241234567']);
        // The local-form booking and the +233 conversation are the same customer.
        const ama = t1.find((c) => c.phone === '+233241234567')!;
        expect(db.store.conversation[0].customerId).toBe(ama.id);
        expect(db.store.booking[0].customerId).toBe(ama.id);
        expect(ama.email).toBe('a@x.com');
        expect(db.store.order[0].customerId).toBe(t1.find((c) => c.phone === '+233209999999')!.id);

        // Same number in another tenant is another customer.
        const t2 = db.store.customer.filter((c) => c.tenantId === 't2');
        expect(t2.map((c) => c.phone)).toEqual(['+233241234567']);
        expect(db.store.booking[2].customerId).toBe(t2[0].id);

        expect(report.customersCreated).toBe(3);
        expect(report.dryRun).toBe(false);
    });

    it('never touches rows whose phone cannot be normalised, and counts them', async () => {
        const db = seed();
        const report = await backfillCustomers(db as any, quiet);
        const bad = db.store.booking.find((b) => b.id === 'b2')!;
        expect(bad.customerId).toBeNull();
        const localNoCountry = db.store.booking.find((b) => b.id === 'b4')!;
        expect(localNoCountry.customerId).toBeNull(); // t2 has no business number to complete "0..."
        expect(db.store.conversation[1].customerId).toBeNull(); // no phone at all
        expect(report.skipped.booking).toBe(2);
        expect(report.skipped.conversation).toBe(1);
    });

    it('does not touch rows that are already linked', async () => {
        const db = seed();
        await backfillCustomers(db as any, quiet);
        expect(db.store.order[1].customerId).toBe('already');
    });

    it('is idempotent: a second run changes and creates nothing', async () => {
        const db = seed();
        await backfillCustomers(db as any, quiet);
        const snapshot = JSON.stringify(db.store);
        const writesBefore = { ...db.writes };
        const again = await backfillCustomers(db as any, quiet);
        expect(JSON.stringify(db.store)).toBe(snapshot);
        expect(db.writes).toEqual(writesBefore);
        expect(again.customersCreated).toBe(0);
        expect(again.linked.booking + again.linked.order + again.linked.conversation).toBe(0);
    });

    it('reuses customers that already exist instead of duplicating them', async () => {
        const db = seed();
        db.store.customer.push({ id: 'pre', tenantId: 't1', phone: '+233241234567', name: 'Known', email: null });
        const report = await backfillCustomers(db as any, quiet);
        expect(db.store.customer.filter((c) => c.tenantId === 't1' && c.phone === '+233241234567')).toHaveLength(1);
        expect(db.store.conversation[0].customerId).toBe('pre');
        expect(db.store.customer.find((c) => c.id === 'pre')!.name).toBe('Known'); // never overwritten
        expect(report.customersCreated).toBe(2); // +233209999999 (t1) and t2's
    });

    it('dry run reports the counts but writes nothing', async () => {
        const db = seed();
        const report = await backfillCustomers(db as any, { ...quiet, dryRun: true });
        expect(db.writes).toEqual({ create: 0, update: 0, updateMany: 0 });
        expect(db.store.customer).toHaveLength(0);
        expect(db.store.booking.every((b) => b.customerId === null || b.id === 'x')).toBe(true);
        expect(report.dryRun).toBe(true);
        expect(report.customersCreated).toBe(3);
        expect(report.linked.booking).toBe(2);
        expect(report.linked.order).toBe(1);
    });

    it('handles more rows than one batch', async () => {
        const rows = Array.from({ length: 25 }, (_, i) => ({
            id: `b${String(i).padStart(3, '0')}`, tenantId: 't1', customerPhone: `+23324000${String(1000 + i)}`,
            customerName: `N${i}`, customerEmail: null, customerId: null,
        }));
        const db = fake({ tenants: [{ id: 't1', whatsappDisplayNumber: '+233200000000' }], booking: rows });
        const report = await backfillCustomers(db as any, { ...quiet, batchSize: 10 });
        expect(db.store.booking.every((b) => b.customerId)).toBe(true);
        expect(report.customersCreated).toBe(25);
    });

    it('limits itself to one tenant when asked', async () => {
        const db = seed();
        await backfillCustomers(db as any, { ...quiet, tenantId: 't2' });
        expect(db.store.customer.every((c) => c.tenantId === 't2')).toBe(true);
        expect(db.store.booking[0].customerId).toBeNull();
    });

    it('does not publish customer.created for backfilled customers', async () => {
        const db = seed() as any;
        db.domainEvent = { create: () => { throw new Error('must not publish'); } };
        await expect(backfillCustomers(db, quiet)).resolves.toBeDefined();
    });
});
