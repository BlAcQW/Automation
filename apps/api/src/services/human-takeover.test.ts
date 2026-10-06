import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    detectTakeover,
    triggerTakeover,
    resumeBot,
    assignConversation,
    getPendingTakeovers,
    KEYWORDS,
    FRUSTRATION,
    type ConversationContext,
} from './human-takeover';

describe('Human Takeover Service', () => {
    describe('detectTakeover', () => {
        it('should detect takeover for explicit keywords', () => {
            const testCases = [
                'I want to speak to human please',
                'talk to agent',
                'I need customer support',
                'Can I speak to a real person?',
            ];

            testCases.forEach((messageContent) => {
                const result = detectTakeover({
                    messageContent,
                    recentMessages: [],
                    botFailureCount: 0,
                });

                expect(result.shouldTakeover).toBe(true);
                expect(result.reason).toBe('keyword');
                expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            });
        });

        it('should detect takeover for frustration indicators', () => {
            const testCases = [
                'This is not working at all',
                'This bot is useless',
                'I am so frustrated with this',
                'This is ridiculous!',
            ];

            testCases.forEach((messageContent) => {
                const result = detectTakeover({
                    messageContent,
                    recentMessages: [],
                    botFailureCount: 0,
                });

                expect(result.shouldTakeover).toBe(true);
                expect(result.reason).toBe('frustration');
                expect(result.confidence).toBeGreaterThanOrEqual(0.8);
            });
        });

        it('should detect takeover for repeated bot failures', () => {
            const result = detectTakeover({
                messageContent: 'hello',
                recentMessages: [],
                botFailureCount: 3,
            });

            expect(result.shouldTakeover).toBe(true);
            expect(result.reason).toBe('repeated_failure');
        });

        it('should detect takeover for response timeout', () => {
            const thirtyOneSecondsAgo = new Date(Date.now() - 31000);

            const result = detectTakeover({
                messageContent: 'hello?',
                recentMessages: [],
                botFailureCount: 0,
                lastBotResponseTime: thirtyOneSecondsAgo,
            });

            expect(result.shouldTakeover).toBe(true);
            expect(result.reason).toBe('timeout');
        });

        it('should NOT trigger takeover for normal messages', () => {
            const normalMessages = [
                'I would like to book an appointment',
                'What times are available?',
                'Thanks!',
                'Yes, that works for me',
            ];

            normalMessages.forEach((messageContent) => {
                const result = detectTakeover({
                    messageContent,
                    recentMessages: [],
                    botFailureCount: 0,
                });

                expect(result.shouldTakeover).toBe(false);
            });
        });

        it('should be case insensitive for keyword detection', () => {
            const result = detectTakeover({
                messageContent: 'SPEAK TO HUMAN',
                recentMessages: [],
                botFailureCount: 0,
            });

            expect(result.shouldTakeover).toBe(true);
            expect(result.reason).toBe('keyword');
        });
    });

    describe('triggerTakeover', () => {
        it('should update conversation state to HUMAN_ACTIVE', async () => {
            const mockPrisma = {
                conversation: {
                    update: vi.fn().mockResolvedValue({}),
                },
            };

            await triggerTakeover(mockPrisma, 'conv-123', 'keyword', 'user-456');

            expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
                where: { id: 'conv-123' },
                data: expect.objectContaining({
                    state: 'HUMAN_ACTIVE',
                    assignedUserId: 'user-456',
                    takeoverReason: 'keyword',
                    takeoverAt: expect.any(Date),
                }),
            });
        });

        it('should set assignedUserId to null if not provided', async () => {
            const mockPrisma = {
                conversation: {
                    update: vi.fn().mockResolvedValue({}),
                },
            };

            await triggerTakeover(mockPrisma, 'conv-123', 'frustration');

            expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
                where: { id: 'conv-123' },
                data: expect.objectContaining({
                    assignedUserId: null,
                }),
            });
        });
    });

    describe('resumeBot', () => {
        it('should resume bot control for a valid conversation', async () => {
            const mockPrisma = {
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-123',
                        state: 'HUMAN_ACTIVE',
                    }),
                    update: vi.fn().mockResolvedValue({}),
                },
            };

            const result = await resumeBot(mockPrisma, 'conv-123', 'user-456');

            expect(result.success).toBe(true);
            expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
                where: { id: 'conv-123' },
                data: expect.objectContaining({
                    state: 'BOT_ACTIVE',
                    botFailureCount: 0,
                    assignedUserId: null,
                    takeoverAt: null,
                }),
            });
            // Handing back to the bot must not wipe an in-flight workflow
            // (e.g. a customer waiting on a payment) — the flow carries on.
            expect(mockPrisma.conversation.update.mock.calls[0][0].data).not.toHaveProperty('botContext');
        });

        it('should return error if conversation not found', async () => {
            const mockPrisma = {
                conversation: {
                    findUnique: vi.fn().mockResolvedValue(null),
                },
            };

            const result = await resumeBot(mockPrisma, 'conv-123', 'user-456');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Conversation not found');
        });

        it('should return error if bot is already active', async () => {
            const mockPrisma = {
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-123',
                        state: 'BOT_ACTIVE',
                    }),
                },
            };

            const result = await resumeBot(mockPrisma, 'conv-123', 'user-456');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot is already active');
        });
    });

    describe('assignConversation', () => {
        it('should assign a conversation to an agent', async () => {
            const mockPrisma = {
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-123',
                        assignedUserId: null,
                    }),
                    update: vi.fn().mockResolvedValue({}),
                },
            };

            const result = await assignConversation(mockPrisma, 'conv-123', 'user-456');

            expect(result.success).toBe(true);
            expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
                where: { id: 'conv-123' },
                data: expect.objectContaining({
                    assignedUserId: 'user-456',
                }),
            });
        });

        it('should return error if already assigned', async () => {
            const mockPrisma = {
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-123',
                        assignedUserId: 'other-user',
                    }),
                },
            };

            const result = await assignConversation(mockPrisma, 'conv-123', 'user-456');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Conversation already assigned');
        });
    });

    describe('getPendingTakeovers', () => {
        it('should return unassigned human-active conversations', async () => {
            const mockConversations = [
                { id: 'conv-1', state: 'HUMAN_ACTIVE', assignedUserId: null },
                { id: 'conv-2', state: 'HUMAN_ACTIVE', assignedUserId: null },
            ];

            const mockPrisma = {
                conversation: {
                    findMany: vi.fn().mockResolvedValue(mockConversations),
                },
            };

            const result = await getPendingTakeovers(mockPrisma, 'tenant-123');

            expect(result).toEqual(mockConversations);
            expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({
                where: {
                    tenantId: 'tenant-123',
                    state: 'HUMAN_ACTIVE',
                    assignedUserId: null,
                },
                orderBy: { takeoverAt: 'asc' },
                include: {
                    messages: {
                        take: 5,
                        orderBy: { createdAt: 'desc' },
                    },
                },
            });
        });
    });

    describe('keyword constants', () => {
        it('should have required takeover keywords', () => {
            expect(KEYWORDS).toContain('speak to human');
            expect(KEYWORDS).toContain('customer support');
            expect(KEYWORDS).toContain('urgent');
        });

        it('should have required frustration indicators', () => {
            expect(FRUSTRATION).toContain('useless');
            expect(FRUSTRATION).toContain('frustrated');
        });
    });
});

describe('detectTakeover by vertical', () => {
    const ctx = (messageContent: string, vertical?: 'APPOINTMENTS' | 'RIDES' | string) =>
        detectTakeover({ messageContent, recentMessages: [], botFailureCount: 0, vertical } as ConversationContext);

    const SALON_KEYWORDS = ['urgent, need a car', 'help me get to the airport', 'emergency pickup', 'I have a complaint', 'let me talk to the manager', 'get me your supervisor'];

    it('APPOINTMENTS keeps every keyword', () => {
        for (const m of SALON_KEYWORDS) {
            expect(ctx(m, 'APPOINTMENTS')).toMatchObject({ shouldTakeover: true, reason: 'keyword', confidence: 0.95 });
        }
    });

    it('omitted vertical behaves as APPOINTMENTS', () => {
        for (const m of SALON_KEYWORDS) expect(ctx(m).shouldTakeover).toBe(true);
    });

    it('RIDES does not hand off on salon-tuned urgency/complaint keywords', () => {
        for (const m of SALON_KEYWORDS) expect(ctx(m, 'RIDES').shouldTakeover).toBe(false);
    });

    it('RIDES still hands off on an explicit request for a person', () => {
        for (const m of ['speak to human', 'can I talk to someone', 'real person please', 'agent please', 'customer support']) {
            expect(ctx(m, 'RIDES')).toMatchObject({ shouldTakeover: true, reason: 'keyword' });
        }
    });

    it('RIDES keeps repeated-failure takeover', () => {
        const r = detectTakeover({ messageContent: 'hi', recentMessages: [], botFailureCount: 3, vertical: 'RIDES' });
        expect(r.reason).toBe('repeated_failure');
    });
});

describe('takeover writes only columns that exist', () => {
    // takeoverAt was written for months but never existed in any migration:
    // every handoff threw at runtime while tsc (widened by the tenant-guard
    // $extends) stayed silent. Check every field we write or order by
    // against the real Prisma schema.
    const conversationFields = new Set(
        Prisma.dmmf.datamodel.models.find((m) => m.name === 'Conversation')!.fields.map((f) => f.name),
    );
    const recorder = () => {
        const used: string[] = [];
        const conversation = {
            update: async ({ data }: any) => { used.push(...Object.keys(data)); return {}; },
            findUnique: async () => ({ id: 'c1', state: 'HUMAN_ACTIVE', assignedUserId: null }),
            findMany: async ({ where, orderBy }: any) => { used.push(...Object.keys(where), ...Object.keys(orderBy ?? {})); return []; },
        };
        return { used, prisma: { conversation } as any };
    };

    it('triggerTakeover', async () => {
        const { used, prisma } = recorder();
        await triggerTakeover(prisma, 'c1', 'reason');
        expect(used.filter((f) => !conversationFields.has(f))).toEqual([]);
    });

    it('resumeBot, getPendingTakeovers and assignConversation', async () => {
        const { used, prisma } = recorder();
        await resumeBot(prisma, 'c1', 'u1');
        await getPendingTakeovers(prisma, 't1');
        await assignConversation(prisma, 'c1', 'u1');
        expect(used.filter((f) => !conversationFields.has(f))).toEqual([]);
    });
});
