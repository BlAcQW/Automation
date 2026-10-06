import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import customersRoutes from './index.js';

type Rec = Record<string, any>;

function matches(row: Rec, where: Rec | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
        if (k === 'OR') return (v as Rec[]).some((w) => matches(row, w));
        if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
        if (v && typeof v === 'object' && 'contains' in v) {
            return String(row[k] ?? '').toLowerCase().includes(String(v.contains).toLowerCase());
        }
        if (v && typeof v === 'object' && !(v instanceof Date)) return true; // relation filters: not modelled
        return row[k] === v;
    });
}

function groupBy(rows: Rec[], args: Rec) {
    const key = args.by[0] as string;
    const groups = new Map<any, Rec[]>();
    for (const r of rows.filter((x) => matches(x, args.where))) {
        groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
    }
    return [...groups.entries()].map(([k, rs]) => ({
        [key]: k,
        _count: rs.length,
        _sum: { totalAmount: rs.reduce((n, r) => n + (r.totalAmount ?? 0), 0) },
    }));
}

const T = 'tenant-1';
let data: { conversation: Rec[]; customer: Rec[]; order: Rec[]; booking: Rec[]; tenant: Rec };
let queries: Rec[];

function prismaFake() {
    queries = [];
    return {
        tenant: { findUnique: async () => ({ maskCustomerContact: true }) },
        conversation: {
            findMany: async (args: Rec) => { queries.push({ m: 'conversation.findMany', args }); return data.conversation.filter((r) => matches(r, args.where)).slice(0, args.take); },
            count: async (args: Rec) => data.conversation.filter((r) => matches(r, args.where)).length,
        },
        customer: {
            findMany: async (args: Rec) => { queries.push({ m: 'customer.findMany', args }); return data.customer.filter((r) => matches(r, args.where)); },
            count: async (args: Rec) => data.customer.filter((r) => matches(r, args.where)).length,
        },
        order: {
            groupBy: async (args: Rec) => groupBy(data.order, args),
            count: async (args: Rec) => data.order.filter((r) => matches(r, args.where)).length,
        },
        booking: { groupBy: async (args: Rec) => groupBy(data.booking, args) },
    };
}

async function app(role: 'OWNER' | 'STAFF'): Promise<FastifyInstance> {
    const a = Fastify();
    await a.register(sensible);
    a.decorate('prisma', prismaFake() as any);
    a.decorate('authenticate', async (req: any) => { req.user = { userId: 'u', tenantId: T, role }; });
    await a.register(customersRoutes, { prefix: '/customers' });
    return a;
}

beforeEach(() => {
    data = {
        conversation: [
            { id: 'conv-linked', tenantId: T, customerPhone: '233241234567', customerHandle: null, channel: 'WHATSAPP', customerName: 'wa profile', customerId: 'cust-1', updatedAt: new Date('2026-01-02') },
            { id: 'conv-legacy', tenantId: T, customerPhone: '+233209999999', customerHandle: null, channel: 'WHATSAPP', customerName: 'Legacy Lee', customerId: null, updatedAt: new Date('2026-01-01') },
        ],
        customer: [{ id: 'cust-1', tenantId: T, phone: '+233241234567', name: 'Ama Mensah', email: 'a@x.com' }],
        order: [
            { id: 'o1', tenantId: T, customerId: 'cust-1', customerPhone: '+233241234567', totalAmount: 10 },
            { id: 'o2', tenantId: T, customerId: null, customerPhone: '+233241234567', totalAmount: 5 }, // pre-linking history
            { id: 'o3', tenantId: T, customerId: null, customerPhone: '+233209999999', totalAmount: 7 },
        ],
        booking: [
            { id: 'b1', tenantId: T, customerId: 'cust-1', customerPhone: '0241234567' }, // typed locally: only the link finds it
            { id: 'b2', tenantId: T, customerId: null, customerPhone: '+233241234567' },
            { id: 'b3', tenantId: T, customerId: null, customerPhone: '+233209999999' },
            { id: 'b4', tenantId: T, customerId: null, customerPhone: '+233209999999' },
        ],
        tenant: {},
    };
});

describe('GET /customers (owner)', () => {
    it('prefers the customer record: its name, and counts from linked plus pre-linking rows once each', async () => {
        const res = await (await app('OWNER')).inject({ method: 'GET', url: '/customers' });
        const rows = res.json().data;
        const linked = rows.find((r: any) => r.conversationId === 'conv-linked');
        expect(linked.name).toBe('Ama Mensah');
        expect(linked.customerId).toBe('cust-1');
        expect(linked.totalOrders).toBe(2); // o1 by link + o2 by phone, never o1 twice
        expect(linked.totalSpent).toBe(15);
        expect(linked.totalBookings).toBe(2); // b1 by link (local phone form) + b2 by phone
    });

    it('stays backward compatible for history that predates linking', async () => {
        const res = await (await app('OWNER')).inject({ method: 'GET', url: '/customers' });
        const legacy = res.json().data.find((r: any) => r.conversationId === 'conv-legacy');
        expect(legacy.name).toBe('Legacy Lee');
        expect(legacy.customerId).toBeNull();
        expect(legacy.totalOrders).toBe(1);
        expect(legacy.totalBookings).toBe(2);
        expect(legacy.phone).toBe('+233209999999');
        expect(legacy.id).toBe('+233209999999');
    });

    it('finds a customer by record phone when the conversation is not linked yet', async () => {
        data.conversation[0].customerId = null;
        const res = await (await app('OWNER')).inject({ method: 'GET', url: '/customers' });
        const row = res.json().data.find((r: any) => r.conversationId === 'conv-linked');
        expect(row.name).toBe('Ama Mensah');
        expect(row.totalBookings).toBe(2);
    });

    it('never reads another tenant: every query is tenant-scoped', async () => {
        await (await app('OWNER')).inject({ method: 'GET', url: '/customers?search=ama' });
        expect(queries.length).toBeGreaterThan(0);
        for (const q of queries) expect(q.args.where.tenantId).toBe(T);
    });
});

describe('GET /customers (staff, masked)', () => {
    it('masks the phone and keeps the list key from leaking it', async () => {
        const res = await (await app('STAFF')).inject({ method: 'GET', url: '/customers' });
        const body = res.json();
        for (const r of body.data) {
            expect(r.contactMasked).toBe(true);
            expect(r.phone).toMatch(/^\+?•+\d{4}$/);
            // The masked key is the conversation id: a hash of the phone could be
            // brute-forced from the visible prefix and last four digits.
            expect(r.id).toBe(r.conversationId);
        }
        const text = JSON.stringify(body);
        expect(text).not.toContain('233241234567');
        expect(text).not.toContain('233209999999');
        expect(text).not.toContain('a@x.com');
    });

    it('masks Instagram/Messenger handles too', async () => {
        data.conversation[0] = { ...data.conversation[0], customerPhone: null, customerHandle: 'ama.mensah.official', channel: 'INSTAGRAM' };
        const res = await (await app('STAFF')).inject({ method: 'GET', url: '/customers' });
        expect(JSON.stringify(res.json())).not.toContain('ama.mensah.official');
    });

    it('does not let a masked viewer search by phone, including the customer record phone', async () => {
        await (await app('STAFF')).inject({ method: 'GET', url: '/customers?search=0241' });
        const convQuery = queries.find((q) => q.m === 'conversation.findMany')!;
        expect(JSON.stringify(convQuery.args.where)).not.toContain('Phone');
        expect(JSON.stringify(convQuery.args.where)).not.toContain('phone');
    });

    it('keeps distinct list keys for two customers with the same last four digits', async () => {
        data.conversation[1].customerPhone = '+233200004567';
        const res = await (await app('STAFF')).inject({ method: 'GET', url: '/customers' });
        const ids = res.json().data.map((r: any) => r.id);
        expect(new Set(ids).size).toBe(2);
    });
});

describe('GET /customers/stats', () => {
    it('counts customer records when they outnumber conversations', async () => {
        data.customer.push(
            { id: 'c2', tenantId: T, phone: '+1', name: null },
            { id: 'c3', tenantId: T, phone: '+2', name: null },
            { id: 'c4', tenantId: T, phone: '+3', name: null },
        );
        const res = await (await app('OWNER')).inject({ method: 'GET', url: '/customers/stats' });
        expect(res.json().totalCustomers).toBe(4);
    });

    it('falls back to conversations for a tenant with no customer records', async () => {
        data.customer = [];
        const res = await (await app('OWNER')).inject({ method: 'GET', url: '/customers/stats' });
        expect(res.json().totalCustomers).toBe(2);
    });
});
