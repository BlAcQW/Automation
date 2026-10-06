/**
 * Test kit for admin routes: a real Fastify app with the REAL auth plugin
 * (real JWT signing, real role resolution) and error handler over a scriptable
 * Prisma stub. Not shipped: only imported by *.test.ts.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import { vi } from 'vitest';

export interface AdminRow {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    isSuperAdmin: boolean;
    isActive: boolean;
    role: string;
    totpSecretEnc: string | null;
    totpEnabledAt: Date | null;
    recoveryCodeHashes: string[];
    createdAt: Date;
    lastLoginAt: Date | null;
}

export function adminRow(over: Partial<AdminRow> = {}): AdminRow {
    return {
        id: 'admin-1', email: 'a@x.com', name: 'Ada Admin', passwordHash: '', isSuperAdmin: false, isActive: true,
        role: 'OWNER', totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [],
        createdAt: new Date('2026-01-01T00:00:00Z'), lastLoginAt: null, ...over,
    };
}

type Fn = import('vitest').Mock<any, any>;
export type PrismaStub = Record<string, Record<string, Fn>> & {
    $transaction: Fn;
    $executeRaw: Fn;
    $queryRaw: Fn;
    admins: Map<string, AdminRow>;
    audits: any[];
};

const DEFAULTS: Record<string, unknown> = { findMany: [], count: 0, groupBy: [], aggregate: {} };

export function makePrisma(): PrismaStub {
    const models = new Map<string, Record<string, Fn>>();
    const admins = new Map<string, AdminRow>();
    const audits: any[] = [];
    const tx: Fn = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(root) : Promise.all(arg)));
    const exec: Fn = vi.fn(async () => 1);
    const queryRaw: Fn = vi.fn(async () => []);

    const modelProxy = (name: string) =>
        new Proxy({} as Record<string, Fn>, {
            get(target, op: string) {
                if (!target[op]) target[op] = vi.fn(async () => (op in DEFAULTS ? DEFAULTS[op] : null));
                return target[op];
            },
        });

    const root: any = new Proxy({} as any, {
        get(_t, prop: string) {
            if (prop === 'then') return undefined;
            if (prop === 'admins') return admins;
            if (prop === 'audits') return audits;
            if (prop === '$transaction') return tx;
            if (prop === '$executeRaw') return exec;
            if (prop === '$queryRaw') return queryRaw;
            if (!models.has(prop)) models.set(prop, modelProxy(prop));
            return models.get(prop);
        },
        set(target, prop: string, value) { (target as any)[prop] = value; return true; },
    });

    // admin model wired to the in-memory map
    root.admin.findUnique.mockImplementation(async ({ where }: any) =>
        (where.id ? admins.get(where.id) : [...admins.values()].find((a) => a.email === where.email)) ?? null);
    root.admin.update.mockImplementation(async ({ where, data }: any) => {
        const row = admins.get(where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        const next = { ...row, ...data };
        admins.set(where.id, next);
        return next;
    });
    root.auditLog.create.mockImplementation(async ({ data }: any) => { audits.push(data); return { id: `audit-${audits.length}`, ...data }; });
    return root;
}

export interface KitOptions {
    prisma: PrismaStub;
    redis?: any;
}

export async function buildAdminTestApp(
    register: (app: FastifyInstance) => Promise<void> | void,
    opts: KitOptions,
): Promise<FastifyInstance> {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation-x';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-long-enough-for-validation';
    process.env.ADMIN_JWT_SECRET ??= 'test-admin-secret-long-enough-for-validation-x';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    const { default: authPlugin } = await import('../../plugins/auth.js');
    const { default: errorHandler } = await import('../../plugins/error-handler.js');

    const app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(errorHandler as any);
    await app.register(cookie);
    await app.register(fp(async (a) => { a.decorate('prisma', opts.prisma as never); }, { name: 'prisma' }));
    await app.register(fp(async (a) => { a.decorate('redis', (opts.redis ?? null) as never); }, { name: 'redis' }));
    await app.register(authPlugin as any);
    await app.register(async (scope) => { await register(scope as unknown as FastifyInstance); }, { prefix: '/admin' });
    await app.ready();
    return app;
}

/** A valid admin access token for `adminId` (the row must exist in prisma.admins). */
export function adminAccessToken(app: FastifyInstance, adminId: string): string {
    return (app as any).jwt.admin.sign({ adminId, type: 'admin_access' }, { expiresIn: '5m' });
}

export function adminRefreshToken(
    app: FastifyInstance,
    adminId: string,
    jti = 'jti-1',
    expiresIn = '7d',
    fam: string | undefined = 'fam-1',
): string {
    return (app as any).jwt.admin.sign({ adminId, type: 'admin_refresh', jti, ...(fam ? { fam } : {}) }, { expiresIn });
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** Sign in as a freshly inserted admin with this role. */
export function signedInAs(app: FastifyInstance, prisma: PrismaStub, role: string, over: Partial<AdminRow> = {}) {
    const row = adminRow({ id: `admin-${role.toLowerCase()}`, email: `${role.toLowerCase()}@x.com`, role, isSuperAdmin: role === 'OWNER', ...over });
    prisma.admins.set(row.id, row);
    return { row, headers: bearer(adminAccessToken(app, row.id)) };
}
