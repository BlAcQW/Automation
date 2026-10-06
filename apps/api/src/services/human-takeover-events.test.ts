import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));

import { publishEvent } from './events/publish.js';
import { triggerTakeover, resumeBot } from './human-takeover.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

const prismaReturning = (row: Record<string, unknown>) => ({
    conversation: {
        update: vi.fn().mockResolvedValue(row),
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', state: 'HUMAN_ACTIVE', tenantId: 't1' }),
    },
});

describe('conversation.handoff on takeover', () => {
    it('publishes conversation.handoff for the conversation tenant, with the reason', async () => {
        const prisma = prismaReturning({ id: 'c1', tenantId: 't1' });
        await triggerTakeover(prisma, 'c1', 'keyword');
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1',
            type: 'conversation.handoff',
            payload: { v: 1, conversationId: 'c1', to: 'HUMAN', reason: 'keyword' },
        });
    });

    it('keeps the update call exactly as before (no extra select)', async () => {
        const prisma = prismaReturning({ id: 'c1', tenantId: 't1' });
        await triggerTakeover(prisma, 'c1', 'x');
        expect(Object.keys(prisma.conversation.update.mock.calls[0][0]).sort()).toEqual(['data', 'where']);
    });

    it('does not fail the takeover when the event cannot be published', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const prisma = prismaReturning({ id: 'c1', tenantId: 't1' });
        await expect(triggerTakeover(prisma, 'c1', 'x')).resolves.toBeUndefined();
        expect(prisma.conversation.update).toHaveBeenCalled();
    });

    it('does not publish when the tenant cannot be determined', async () => {
        await triggerTakeover(prismaReturning({}), 'c1', 'x');
        expect(publish).not.toHaveBeenCalled();
    });

    it('does not publish when the takeover write itself fails', async () => {
        const prisma = { conversation: { update: vi.fn().mockRejectedValue(new Error('db')) } };
        await expect(triggerTakeover(prisma, 'c1', 'x')).rejects.toThrow('db');
        expect(publish).not.toHaveBeenCalled();
    });
});

describe('conversation.resumed on resumeBot', () => {
    it('publishes once the conversation is back with the bot', async () => {
        const prisma = prismaReturning({ id: 'c1', tenantId: 't1' });
        const r = await resumeBot(prisma, 'c1', 'u1');
        expect(r.success).toBe(true);
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1', type: 'conversation.resumed', payload: { v: 1, conversationId: 'c1' },
        });
    });

    it('publishes nothing when there was nothing to resume', async () => {
        const prisma = prismaReturning({});
        prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', state: 'BOT_ACTIVE', tenantId: 't1' });
        await resumeBot(prisma, 'c1', 'u1');
        expect(publish).not.toHaveBeenCalled();
    });
});
