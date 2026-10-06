/**
 * Test harness for the public API and developer routes.
 *
 * Builds a real Fastify instance with the REAL api-key-auth plugin and routes,
 * over a stub Prisma that (a) is scripted per `model.op`, (b) records every
 * query, and (c) enforces the real blocking tenant guard using the tenant
 * context the auth plugin actually bound. So a route that forgets a tenantId
 * filter fails here exactly as it would in production (TenantGuardError -> 500,
 * and a recorded violation).
 */

import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import errorHandler from '../plugins/error-handler.js';
import { TENANT_SCOPED_MODELS } from '../plugins/prisma.js';
import { guardDecision, TenantGuardError } from '../plugins/tenant-guard.js';
import { tenantContextOnRequest, getTenantContext } from '../lib/tenant-context.js';
import { generateApiKey, hashSecret, type ApiKeyScope } from '../services/api-keys.js';

export function configMock() {
    return {
        config: {
            nodeEnv: 'test',
            encryptionKey: '0'.repeat(64),
            frontendUrl: 'https://app.example',
            paystack: { callbackUrl: undefined },
            platformPaystack: null,
            platformWhatsapp: { accessToken: 'platform-token' },
        },
    };
}

export interface RecordedQuery {
    model: string;
    op: string;
    args: any;
}

type Responder = (args: any, q: { queries: RecordedQuery[] }) => unknown;

export interface Harness {
    app: FastifyInstance;
    queries: RecordedQuery[];
    violations: string[];
    respond: (key: string, fn: Responder | unknown) => void;
    makeKey: (opts?: { scopes?: ApiKeyScope[]; tenantId?: string; revoked?: boolean; name?: string }) => string;
    find: (model: string, op: string) => RecordedQuery[];
    close: () => Promise<void>;
}

const MUTATING = new Set(['updateMany', 'deleteMany']);

export async function buildHarness(
    register: (app: FastifyInstance, h: { prisma: any }) => Promise<void> | void,
    opts: { setup?: (app: FastifyInstance) => Promise<void> | void } = {},
): Promise<Harness> {
    const queries: RecordedQuery[] = [];
    const violations: string[] = [];
    const responders = new Map<string, Responder | unknown>();
    const keyRows = new Map<string, any>();
    let seq = 0;

    const modelStub = (name: string) =>
        new Proxy(
            {},
            {
                get(_t, op: string) {
                    return async (args: any) => {
                        const model = name.charAt(0).toUpperCase() + name.slice(1);
                        queries.push({ model: name, op, args });
                        const decision = guardDecision({
                            model,
                            operation: op,
                            where: args?.where,
                            ctx: getTenantContext(),
                            mode: 'block',
                            scopedModels: TENANT_SCOPED_MODELS,
                        });
                        if (decision !== 'allow') {
                            violations.push(`${model}.${op} ${JSON.stringify(args?.where)}`);
                            throw new TenantGuardError(model, op);
                        }
                        const r = responders.get(`${name}.${op}`);
                        if (r !== undefined) return typeof r === 'function' ? (r as Responder)(args, { queries }) : r;

                        if (name === 'apiKey' && op === 'findUnique') return keyRows.get(args.where.prefix) ?? null;
                        if (name === 'tenant' && op === 'findUnique') return { id: args.where.id, isActive: true };
                        if (op === 'findMany') return [];
                        if (op === 'count') return 0;
                        if (MUTATING.has(op)) return { count: 1 };
                        if (op === 'create') return { id: `new-${++seq}`, createdAt: new Date(), ...args.data };
                        return null;
                    };
                },
            },
        );

    const stub: any = new Proxy(
        {},
        {
            get(target: any, prop: string) {
                if (prop === '$transaction') {
                    return async (arg: any) => (typeof arg === 'function' ? arg(stub) : Promise.all(arg));
                }
                if (prop === '$executeRaw' || prop === '$queryRaw') {
                    return async (...a: unknown[]) => {
                        queries.push({ model: '$raw', op: prop, args: a });
                        const r = responders.get(prop);
                        if (r !== undefined) return typeof r === 'function' ? (r as Responder)(a, { queries }) : r;
                        // Default for $queryRaw: an advisory try-lock that is granted.
                        return prop === '$queryRaw' ? [{ locked: true }] : 0;
                    };
                }
                if (prop === 'then') return undefined;
                if (!target[prop]) target[prop] = modelStub(prop);
                return target[prop];
            },
        },
    );

    const app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(
        fp(async (a) => { a.decorate('prisma', stub); }, { name: 'prisma' }),
    );
    // Stand-in for plugins/auth.ts: it owns the per-request tenant-context store.
    await app.register(
        fp(async (a) => { a.addHook('onRequest', tenantContextOnRequest); }, { name: 'auth' }),
    );
    if (opts.setup) await opts.setup(app);
    await register(app, { prisma: stub });
    await app.ready();

    return {
        app,
        queries,
        violations,
        respond: (key, fn) => { responders.set(key, fn); },
        makeKey: ({ scopes = ['messages:write'], tenantId = 'tenant-a', revoked = false, name = 'test key' } = {}) => {
            const { key, prefix, secret } = generateApiKey();
            keyRows.set(prefix, {
                id: `key-${prefix}`, tenantId, name, prefix, secretHash: hashSecret(secret), scopes,
                lastUsedAt: null, revokedAt: revoked ? new Date() : null,
            });
            return key;
        },
        find: (model, op) => queries.filter((q) => q.model === model && q.op === op),
        close: () => app.close(),
    };
}
