import { describe, it, expect, vi } from 'vitest';

const resolveConversation = vi.fn();
vi.mock('../../services/conversation-resolver.js', () => ({ resolveConversation: (...a: unknown[]) => resolveConversation(...a) }));

import { processWebhook } from './index.js';

const ev = (id: string) => ({ sender: { id }, message: { mid: `m-${id}`, text: 'hi' } });

describe('processWebhook batch isolation and ordering', () => {
    it('keeps processing later messages when one throws, then rejects so the row retries', async () => {
        resolveConversation.mockReset();
        resolveConversation.mockImplementation(async (_p: unknown, a: { externalId: string }) => {
            if (a.externalId === 'bad') throw new Error('resolver down');
            return { id: 'c-' + a.externalId, state: 'HUMAN_ACTIVE', botFailureCount: 0 };
        });
        const message = { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) };
        const fastify: any = {
            redis: null,
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
            prisma: {
                tenant: { findFirst: vi.fn(async () => ({ id: 't1' })) },
                message,
                conversation: { update: vi.fn(async () => ({})) },
            },
        };
        const payload: any = { object: 'page', entry: [{ id: 'p1', messaging: [ev('bad'), ev('good')] }] };

        await expect(processWebhook(fastify, payload)).rejects.toThrow(/1 webhook item/);
        expect(message.create).toHaveBeenCalledTimes(1); // 'good' was still handled
        expect(fastify.log.error).toHaveBeenCalled();
    });

    it('serialises two messages from one sender and parallelises different senders', async () => {
        resolveConversation.mockReset();
        let active = 0; let maxActiveSameSender = 0;
        const running = new Set<string>();
        let overlap = false; let sawParallel = false;
        resolveConversation.mockImplementation(async (_p: unknown, a: { externalId: string }) => {
            if (running.has(a.externalId)) overlap = true;
            running.add(a.externalId); active++;
            if (running.size > 1) sawParallel = true;
            maxActiveSameSender = Math.max(maxActiveSameSender, active);
            await new Promise((r) => setTimeout(r, 20));
            running.delete(a.externalId); active--;
            return { id: 'c-' + a.externalId, state: 'HUMAN_ACTIVE', botFailureCount: 0 };
        });
        const fastify: any = {
            redis: null,
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
            prisma: {
                tenant: { findFirst: vi.fn(async () => ({ id: 't1' })) },
                message: { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
                conversation: { update: vi.fn(async () => ({})) },
            },
        };
        const a = (id: string) => ({ ...ev('same'), message: { mid: id, text: 'x' } });
        const mk = (events: any[]) => ({ object: 'page', entry: [{ id: 'p1', messaging: events }] }) as any;
        await Promise.all([
            processWebhook(fastify, mk([a('1')])),
            processWebhook(fastify, mk([a('2')])),
            processWebhook(fastify, mk([ev('other')])),
        ]);
        expect(overlap).toBe(false);
        expect(sawParallel).toBe(true);
    });
});
