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
                    state: 'MAIN_MENU',
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
                    state: 'MAIN_MENU',
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
                state: 'MAIN_MENU',
            });

            expect(result.shouldTakeover).toBe(true);
            expect(result.reason).toBe('repeated_failure');
        });

        it('should detect takeover when in CONTACT_SUPPORT state', () => {
            const result = detectTakeover({
                messageContent: 'I need help with my order',
                recentMessages: [],
                botFailureCount: 0,
                state: 'CONTACT_SUPPORT',
            });

            expect(result.shouldTakeover).toBe(true);
            expect(result.reason).toBe('explicit_request');
            expect(result.confidence).toBe(1.0);
        });

        it('should detect takeover for response timeout', () => {
            const thirtyOneSecondsAgo = new Date(Date.now() - 31000);

            const result = detectTakeover({
                messageContent: 'hello?',
                recentMessages: [],
                botFailureCount: 0,
                state: 'MAIN_MENU',
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
                    state: 'MAIN_MENU',
                });

                expect(result.shouldTakeover).toBe(false);
            });
        });

        it('should be case insensitive for keyword detection', () => {
            const result = detectTakeover({
                messageContent: 'SPEAK TO HUMAN',
                recentMessages: [],
                botFailureCount: 0,
                state: 'MAIN_MENU',
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
                    botContext: JSON.stringify({ state: 'WELCOME' }),
                    assignedUserId: null,
                    resumedByUserId: 'user-456',
                }),
            });
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
