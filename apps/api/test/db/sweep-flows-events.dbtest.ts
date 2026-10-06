/**
 * Column-existence sweep, part 2: flow store, external app, webhook inbox,
 * webhook delivery, idempotency lock. All of these take `prisma: any` or a
 * hand-rolled structural type.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedConversation, seedTenant } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { silentLogger } from './helpers/fake-fastify.js';
import { tenantContext } from '../../src/lib/tenant-context.js';
import {
    createPrismaFlowStore,
} from '../../src/services/flows/index.js';
import { createDefinitionsService } from '../../src/services/flows/definitions.js';
import { createFlowPorts } from '../../src/services/flow-ports.js';
import {
    deleteExternalApp, getExternalApp, rotateExternalAppSecret, saveExternalApp, syncExternalAppSubscription,
} from '../../src/services/external-app.js';
import {
    MAX_ATTEMPTS as INBOX_MAX_ATTEMPTS, PENDING_STALE_MS as INBOX_PENDING_STALE_MS, PROCESSING_STUCK_MS,
    DONE_RETENTION_MS, claimInboxRow, persistInbound, processInboxRow, purgeInbox, sweepInbox,
} from '../../src/services/inbound-queue.js';
import {
    MAX_ATTEMPTS as DELIVERY_MAX_ATTEMPTS, CLAIM_STUCK_MS, RETENTION_MS, claimDelivery, processDelivery, purgeEvents, sweepDeliveries,
} from '../../src/services/events/delivery.js';
import { publishEvent } from '../../src/services/events/publish.js';
import { LockTimeoutError } from '../../src/services/conversation-lock.js';
import { acquireKeyLock } from '../../src/routes/v1/idempotency.js';
import { encrypt } from '../../src/services/crypto.js';

const turboSampleFlow = {
    key: 'turbo-rides',
    version: 1,
    start: 'menu',
    states: {
        menu: { type: 'menu', prompt: 'Welcome. What would you like?', options: [{ label: 'Book a ride', next: 'done' }] },
        done: { type: 'end', text: 'Thanks!' },
    },
};

describe('flow definitions + conversation state through the prisma flow store', () => {
    let tenantId: string;
    beforeEach(async () => { tenantId = (await seedTenant()).id; });
    const inTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ tenantId, userId: 'u' }, async () => await fn());

    it('versions, activates, rolls back and loads a definition (inside a bound tenant context)', async () => {
        const prisma = await guardedPrisma();
        const svc = createDefinitionsService(createPrismaFlowStore(prisma as never), { checkPaymentKinds: false });
        const v1 = await inTenant(() => svc.createVersion({ tenantId, key: 'rides', definition: turboSampleFlow, createdBy: 'admin-1' }));
        const v2 = await inTenant(() => svc.createVersion({ tenantId, key: 'rides', definition: turboSampleFlow }));
        expect([v1.version, v2.version]).toEqual([1, 2]);
        expect((await inTenant(() => svc.loadActive({ tenantId }, 'rides')))?.version).toBe(2);
        await inTenant(() => svc.activateVersion({ tenantId }, 'rides', 1));
        const rows = await rawPrisma().flowDefinition.findMany({ where: { tenantId }, orderBy: { version: 'asc' } });
        expect(rows.map((r) => [r.version, r.isActive])).toEqual([[1, true], [2, false]]);
        expect(rows[0].createdBy).toBe('admin-1');
        expect((await inTenant(() => svc.list({ tenantId }))).length).toBe(2);
    });

    it('findDefinition falls back to the platform default (read without tenant context, as the worker does)', async () => {
        const prisma = await guardedPrisma();
        const store = createPrismaFlowStore(prisma as never);
        const svc = createDefinitionsService(store, { checkPaymentKinds: false });
        await svc.createVersion({ tenantId: null, vertical: 'RIDES', key: 'turbo-rides', definition: turboSampleFlow });
        const found = await store.findDefinition({ tenantId, key: 'turbo-rides', vertical: 'RIDES' } as never);
        expect(found).toMatchObject({ key: 'turbo-rides', version: 1 });
        expect(await store.findDefinition({ tenantId, key: 'missing', vertical: 'RIDES' } as never)).toBeNull();
    });

    it('two concurrent createVersion calls for one key never leave duplicate versions', async () => {
        const prisma = await guardedPrisma();
        const svc = createDefinitionsService(createPrismaFlowStore(prisma as never), { checkPaymentKinds: false });
        await race(4, () => svc.createVersion({ tenantId, key: 'rides', definition: turboSampleFlow }));
        const versions = (await rawPrisma().flowDefinition.findMany({ where: { tenantId, key: 'rides' } })).map((r) => r.version);
        expect(new Set(versions).size).toBe(versions.length);
    });

    it('saveBotContext is an optimistic lock on contextVersion', async () => {
        const prisma = await guardedPrisma();
        const store = createPrismaFlowStore(prisma as never);
        const conv = await seedConversation(tenantId);
        const loaded = await store.loadConversation(tenantId, conv.id);
        expect(loaded).toMatchObject({ id: conv.id, contextVersion: 0 });
        const { ok } = await race(5, () => store.saveBotContext(tenantId, conv.id, 0, { flow: { n: 1 } }));
        expect(ok.filter(Boolean)).toHaveLength(1);
        const row = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conv.id } });
        expect(row.contextVersion).toBe(1);
        expect(row.botContext).toEqual({ flow: { n: 1 } });
        expect(await store.saveBotContext(tenantId, conv.id, 0, { stale: true })).toBe(false);
        expect(await store.loadConversation('other-tenant', conv.id)).toBeNull();
    });

    it('flow ports: staff handoff takes the conversation over, queue-only notifies', async () => {
        const prisma = await guardedPrisma();
        const conv = await seedConversation(tenantId);
        const ports = createFlowPorts({ prisma, tenant: { id: tenantId }, log: silentLogger });
        await ports.enqueueStaff({ tenantId, conversationId: conv.id, queue: 'billing', handoff: true } as never);
        const row = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conv.id } });
        expect(row).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverReason: 'billing' });
        expect(row.takeoverAt).toBeInstanceOf(Date);
        await ports.enqueueStaff({ tenantId, conversationId: conv.id, queue: 'billing' } as never);
        const n = await rawPrisma().notification.findFirstOrThrow({ where: { tenantId } });
        expect(n.metadata).toMatchObject({ kind: 'flow_staff_queue', conversationId: conv.id });
        await expect(ports.enqueueStaff({ tenantId: 'someone-else', conversationId: conv.id } as never)).rejects.toThrow();
    });
});

describe('external app configuration', () => {
    let tenantId: string;
    beforeEach(async () => { tenantId = (await seedTenant()).id; });

    it('save/get/rotate/delete keep the managed webhook subscription in sync', async () => {
        const prisma = await guardedPrisma();
        const created = await saveExternalApp(prisma as never, tenantId, { name: 'Turbo', url: 'https://example.test/hook' });
        expect(created.signingSecret).toMatch(/^whsec_/);
        const sub = await rawPrisma().webhookSubscription.findFirstOrThrow({ where: { tenantId, description: 'external-app' } });
        expect(sub).toMatchObject({ url: 'https://example.test/hook', isActive: true });
        expect(sub.events.length).toBeGreaterThan(0);

        const updated = await saveExternalApp(prisma as never, tenantId, { name: 'Turbo 2', url: 'https://example.test/hook2', isActive: false });
        expect(updated.signingSecret).toBeUndefined();
        expect((await getExternalApp(prisma as never, tenantId))).toMatchObject({ name: 'Turbo 2', isActive: false });
        expect((await rawPrisma().webhookSubscription.findFirstOrThrow({ where: { tenantId } }))).toMatchObject({ url: 'https://example.test/hook2', isActive: false });

        const before = (await rawPrisma().externalApp.findFirstOrThrow({ where: { tenantId } })).signingSecretEnc;
        expect(await rotateExternalAppSecret(prisma as never, tenantId)).toMatch(/^whsec_/);
        expect((await rawPrisma().externalApp.findFirstOrThrow({ where: { tenantId } })).signingSecretEnc).not.toBe(before);

        await deleteExternalApp(prisma as never, tenantId);
        expect(await getExternalApp(prisma as never, tenantId)).toBeNull();
        expect((await rawPrisma().webhookSubscription.findFirstOrThrow({ where: { tenantId } })).isActive).toBe(false);
        expect(await rotateExternalAppSecret(prisma as never, tenantId)).toBeNull();
    });

    it('concurrent first saves: exactly one app, one signing secret shown, one subscription (advisory lock)', async () => {
        const prisma = await guardedPrisma();
        await Promise.all(Array.from({ length: 20 }, () => prisma.tenant.count()));
        const { ok, failed } = await race(5, () => saveExternalApp(prisma as never, tenantId, { name: 'Turbo', url: 'https://example.test/hook' }));
        expect(failed.map((e) => `${e?.code ?? e?.message}`)).toEqual([]);
        expect(ok.filter((r) => r.signingSecret)).toHaveLength(1);
        expect(await rawPrisma().externalApp.count({ where: { tenantId } })).toBe(1);
        expect(await rawPrisma().webhookSubscription.count({ where: { tenantId } })).toBe(1);
    });

    it('syncExternalAppSubscription concurrently never duplicates the subscription', async () => {
        const prisma = await guardedPrisma();
        await rawPrisma().externalApp.create({ data: { tenantId, name: 'T', url: 'https://example.test/a', signingSecretEnc: 'x' } });
        const { failed } = await race(8, () => syncExternalAppSubscription(prisma as never, tenantId));
        expect(failed).toEqual([]);
        expect(await rawPrisma().webhookSubscription.count({ where: { tenantId } })).toBe(1);
    });
});

describe('webhook inbox (durable inbound queue)', () => {
    const deps = (process: (p: any) => Promise<void>, queue?: any) => ({ log: silentLogger, process, queue }) as any;
    let prisma: any;
    beforeEach(async () => { prisma = await guardedPrisma(); });

    it('persist -> process marks DONE with processedAt, and the payload round-trips', async () => {
        const id = await persistInbound(prisma, { entry: [{ id: 1 }] });
        const seen: any[] = [];
        expect(await processInboxRow({ ...deps(async (p) => { seen.push(p); }), prisma }, id)).toBe('done');
        expect(seen).toEqual([{ entry: [{ id: 1 }] }]);
        const row = await rawPrisma().webhookInbox.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ status: 'DONE', attempts: 1, lastError: null, claimedAt: null });
        expect(row.processedAt).toBeInstanceOf(Date);
    });

    it('two workers racing for one row: exactly one processes it', async () => {
        const id = await persistInbound(prisma, { n: 1 });
        const handler = vi.fn(async () => { await new Promise((r) => setTimeout(r, 100)); });
        const { ok } = await race(6, () => processInboxRow({ ...deps(handler), prisma }, id));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(ok.filter((o) => o === 'done')).toHaveLength(1);
        expect(ok.filter((o) => o === 'skipped')).toHaveLength(5);
        expect(await claimInboxRow(prisma, id)).toBeNull();
    });

    it('a failing turn goes back to PENDING with backoff and the error recorded, then FAILED with an alert after the last attempt', async () => {
        const queue = { add: vi.fn().mockResolvedValue(undefined) };
        const id = await persistInbound(prisma, { n: 1 });
        const boom = async () => { throw new Error('agent exploded'); };
        expect(await processInboxRow({ ...deps(boom, queue), prisma }, id)).toBe('retry');
        let row = await rawPrisma().webhookInbox.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'agent exploded', claimedAt: null });
        expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
        expect(queue.add).toHaveBeenCalledTimes(1);

        await rawPrisma().webhookInbox.update({ where: { id }, data: { attempts: INBOX_MAX_ATTEMPTS - 1 } });
        expect(await processInboxRow({ ...deps(boom, queue), prisma }, id)).toBe('failed');
        row = await rawPrisma().webhookInbox.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe('FAILED');
        expect(await rawPrisma().platformAlert.count()).toBe(1);
    });

    it('a busy conversation hands the row back without burning an attempt', async () => {
        const queue = { add: vi.fn().mockResolvedValue(undefined) };
        const id = await persistInbound(prisma, { n: 1 });
        const busy = async () => { throw new LockTimeoutError('k', 1); };
        expect(await processInboxRow({ ...deps(busy, queue), prisma }, id)).toBe('busy');
        const row = await rawPrisma().webhookInbox.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ status: 'PENDING', attempts: 0, claimedAt: null });
        expect(row.nextAttemptAt).toBeInstanceOf(Date);
    });

    it('sweep recovers stuck PROCESSING rows, re-dispatches stale PENDING rows; purge removes old DONE rows', async () => {
        const db = rawPrisma();
        const now = new Date();
        const stuck = await persistInbound(prisma, { s: 1 });
        await db.webhookInbox.update({ where: { id: stuck }, data: { status: 'PROCESSING', attempts: 1, claimedAt: new Date(now.getTime() - PROCESSING_STUCK_MS - 1000) } });
        const stale = await persistInbound(prisma, { s: 2 });
        await db.webhookInbox.update({ where: { id: stale }, data: { receivedAt: new Date(now.getTime() - INBOX_PENDING_STALE_MS - 1000) } });
        const fresh = await persistInbound(prisma, { s: 3 });
        const old = await persistInbound(prisma, { s: 4 });
        await db.webhookInbox.update({ where: { id: old }, data: { status: 'DONE', receivedAt: new Date(now.getTime() - DONE_RETENTION_MS - 1000) } });

        const dispatched: string[] = [];
        const res = await sweepInbox({ prisma, log: silentLogger, dispatch: async (id) => { dispatched.push(id); } }, now);
        expect(res.recovered).toBe(1);
        expect(dispatched).toContain(stale);
        expect(dispatched).toContain(stuck); // recovered rows are PENDING with nextAttemptAt = now
        expect(dispatched).not.toContain(fresh);
        expect((await db.webhookInbox.findUniqueOrThrow({ where: { id: stuck } })).lastError).toBe('Recovered after processing stalled');

        const purged = await purgeInbox({ prisma, log: silentLogger }, now);
        expect(purged.done).toBe(1);
        expect(await db.webhookInbox.findUnique({ where: { id: old } })).toBeNull();
    });
});

describe('outgoing webhook delivery', () => {
    let tenantId: string; let subId: string; let prisma: any;
    beforeEach(async () => {
        prisma = await guardedPrisma();
        tenantId = (await seedTenant()).id;
        subId = (await rawPrisma().webhookSubscription.create({
            data: { tenantId, url: 'https://example.test/hook', events: ['*'], secretEnc: encrypt('whsec_test') },
        })).id;
    });
    const newDelivery = async () => {
        const { eventId } = await publishEvent(prisma, { tenantId, type: 'booking.created', payload: { v: 1, bookingId: 'b1' } });
        return (await rawPrisma().webhookDelivery.findFirstOrThrow({ where: { eventId: eventId! } })).id;
    };

    it('signs and delivers, then records SUCCEEDED with the status code', async () => {
        const id = await newDelivery();
        const post = vi.fn().mockResolvedValue({ statusCode: 204 });
        expect(await processDelivery({ prisma, log: silentLogger, post }, id)).toBe('succeeded');
        const call = post.mock.calls[0][0];
        expect(call.url).toBe('https://example.test/hook');
        expect(Object.keys(call.headers).length).toBeGreaterThanOrEqual(3);
        const row = await rawPrisma().webhookDelivery.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ status: 'SUCCEEDED', attempts: 1, lastStatusCode: 204, lastError: null, claimedAt: null });
        expect(row.deliveredAt).toBeInstanceOf(Date);
    });

    it('two workers racing for one delivery: it is posted once', async () => {
        const id = await newDelivery();
        const post = vi.fn(async () => { await new Promise((r) => setTimeout(r, 100)); return { statusCode: 200 }; });
        const { ok } = await race(5, () => processDelivery({ prisma, log: silentLogger, post }, id));
        expect(post).toHaveBeenCalledTimes(1);
        expect(ok.filter((o) => o === 'succeeded')).toHaveLength(1);
        expect(await claimDelivery(prisma, id)).toBeNull();
    });

    it('a failing endpoint retries with backoff, then FAILED with one alert', async () => {
        const queue = { add: vi.fn().mockResolvedValue(undefined) };
        const id = await newDelivery();
        const post = vi.fn().mockResolvedValue({ statusCode: 500 });
        expect(await processDelivery({ prisma, log: silentLogger, post, queue }, id)).toBe('retry');
        let row = await rawPrisma().webhookDelivery.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'HTTP 500', lastStatusCode: 500, claimedAt: null });
        expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

        await rawPrisma().webhookDelivery.update({ where: { id }, data: { attempts: DELIVERY_MAX_ATTEMPTS - 1, nextAttemptAt: null } });
        expect(await processDelivery({ prisma, log: silentLogger, post, queue }, id)).toBe('failed');
        row = await rawPrisma().webhookDelivery.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe('FAILED');
        const alerts = await rawPrisma().platformAlert.findMany({ where: { kind: 'webhook.delivery_failed' } });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].dedupeKey).toBe(`webhook.delivery_failed:${subId}`);
    });

    it('a disabled subscription fails the delivery without posting', async () => {
        const id = await newDelivery();
        await rawPrisma().webhookSubscription.update({ where: { id: subId }, data: { isActive: false } });
        const post = vi.fn();
        expect(await processDelivery({ prisma, log: silentLogger, post }, id)).toBe('failed');
        expect(post).not.toHaveBeenCalled();
    });

    it('sweep recovers stalled claims and re-dispatches due rows; purge drops old SUCCEEDED deliveries and their events', async () => {
        const db = rawPrisma();
        const now = new Date();
        const stalled = await newDelivery();
        await db.webhookDelivery.update({ where: { id: stalled }, data: { claimedAt: new Date(now.getTime() - CLAIM_STUCK_MS - 1000), attempts: 1 } });
        const due = await newDelivery();
        await db.webhookDelivery.update({ where: { id: due }, data: { nextAttemptAt: new Date(now.getTime() - 1000) } });
        const dispatched: string[] = [];
        const res = await sweepDeliveries({ prisma, log: silentLogger, dispatch: async (id) => { dispatched.push(id); } }, now);
        expect(res.recovered).toBe(1);
        expect(dispatched).toEqual(expect.arrayContaining([stalled, due]));

        const oldDelivery = await newDelivery();
        const d = await db.webhookDelivery.update({ where: { id: oldDelivery }, data: { status: 'SUCCEEDED', createdAt: new Date(now.getTime() - RETENTION_MS - 1000) } });
        await db.domainEvent.update({ where: { id: d.eventId }, data: { createdAt: new Date(now.getTime() - RETENTION_MS - 1000) } });
        const purged = await purgeEvents({ prisma, log: silentLogger }, now);
        expect(purged).toEqual({ deliveries: 1, events: 1 });
        expect(await db.domainEvent.findUnique({ where: { id: d.eventId } })).toBeNull();
    });
});

describe('v1 idempotency advisory lock', () => {
    it('a second transaction on the same (tenant, key) gets 409 while the first holds it; other keys/tenants are free', async () => {
        const prisma: any = await guardedPrisma();
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        let acquired!: () => void;
        const gotLock = new Promise<void>((r) => { acquired = r; });
        const first = prisma.$transaction(async (tx: any) => {
            await acquireKeyLock(tx, 't1', 'key-1');
            acquired();
            await held;
        });
        await gotLock;
        await expect(prisma.$transaction((tx: any) => acquireKeyLock(tx, 't1', 'key-1'))).rejects.toMatchObject({ statusCode: 409 });
        await prisma.$transaction((tx: any) => acquireKeyLock(tx, 't1', 'key-2'));
        await prisma.$transaction((tx: any) => acquireKeyLock(tx, 't2', 'key-1'));
        release();
        await first;
        await prisma.$transaction((tx: any) => acquireKeyLock(tx, 't1', 'key-1')); // free again after commit
    });
});
