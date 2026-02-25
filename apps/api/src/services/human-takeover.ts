/**
 * Human Takeover Service
 * 
 * Handles automatic detection for when a human agent should take over
 * a WhatsApp conversation from the bot, and manages the pause/resume logic.
 */

// Keywords that trigger human takeover
const TAKEOVER_KEYWORDS = [
    'speak to human',
    'talk to human',
    'speak to agent',
    'talk to agent',
    'speak to someone',
    'talk to someone',
    'human please',
    'agent please',
    'real person',
    'customer service',
    'customer support',
    'help me',
    'urgent',
    'emergency',
    'complaint',
    'manager',
    'supervisor',
];

// Phrases indicating frustration
const FRUSTRATION_INDICATORS = [
    'this is not working',
    'doesn\'t work',
    'not helping',
    'useless',
    'stupid bot',
    'i give up',
    'frustrated',
    'angry',
    'ridiculous',
];

export interface TakeoverResult {
    shouldTakeover: boolean;
    reason?: 'keyword' | 'frustration' | 'repeated_failure' | 'explicit_request' | 'timeout';
    confidence: number; // 0-1
}

export interface ConversationContext {
    messageContent: string;
    recentMessages: string[];
    botFailureCount: number;
    lastBotResponseTime?: Date;
    state: string;
}

/**
 * Analyzes a message to determine if human takeover is needed
 */
export function detectTakeover(context: ConversationContext): TakeoverResult {
    const messageContent = context.messageContent.toLowerCase().trim();

    // Check for explicit takeover keywords
    for (const keyword of TAKEOVER_KEYWORDS) {
        if (messageContent.includes(keyword)) {
            return {
                shouldTakeover: true,
                reason: 'keyword',
                confidence: 0.95,
            };
        }
    }

    // Check for frustration indicators
    for (const indicator of FRUSTRATION_INDICATORS) {
        if (messageContent.includes(indicator)) {
            return {
                shouldTakeover: true,
                reason: 'frustration',
                confidence: 0.85,
            };
        }
    }

    // Check for repeated bot failures (3+ failures suggest bot can't handle)
    if (context.botFailureCount >= 3) {
        return {
            shouldTakeover: true,
            reason: 'repeated_failure',
            confidence: 0.75,
        };
    }

    // Check if already in CONTACT_SUPPORT state
    if (context.state === 'CONTACT_SUPPORT') {
        return {
            shouldTakeover: true,
            reason: 'explicit_request',
            confidence: 1.0,
        };
    }

    // Check for response timeout (bot hasn't responded in 30+ seconds)
    if (context.lastBotResponseTime) {
        const timeSinceResponse = Date.now() - context.lastBotResponseTime.getTime();
        if (timeSinceResponse > 30000) { // 30 seconds
            return {
                shouldTakeover: true,
                reason: 'timeout',
                confidence: 0.6,
            };
        }
    }

    return {
        shouldTakeover: false,
        confidence: 0,
    };
}

/**
 * Triggers human takeover for a conversation
 */
export async function triggerTakeover(
    prisma: any,
    conversationId: string,
    reason: string,
    assignedUserId?: string
): Promise<void> {
    await prisma.conversation.update({
        where: { id: conversationId },
        data: {
            state: 'HUMAN_ACTIVE',
            assignedUserId: assignedUserId || null,
            takeoverReason: reason,
            takeoverAt: new Date(),
        },
    });
}

/**
 * Resumes bot control for a conversation
 */
export async function resumeBot(
    prisma: any,
    conversationId: string,
    userId: string
): Promise<{ success: boolean; error?: string }> {
    // Find conversation
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
    });

    if (!conversation) {
        return { success: false, error: 'Conversation not found' };
    }

    if (conversation.state !== 'HUMAN_ACTIVE') {
        return { success: false, error: 'Bot is already active' };
    }

    // Update conversation state
    await prisma.conversation.update({
        where: { id: conversationId },
        data: {
            state: 'BOT_ACTIVE',
            botContext: JSON.stringify({ state: 'WELCOME' }), // Reset to welcome state
            assignedUserId: null,
            takeoverReason: null,
            resumedAt: new Date(),
            resumedByUserId: userId,
        },
    });

    return { success: true };
}

/**
 * Gets conversations that need human attention
 */
export async function getPendingTakeovers(
    prisma: any,
    tenantId: string
): Promise<any[]> {
    return prisma.conversation.findMany({
        where: {
            tenantId,
            state: 'HUMAN_ACTIVE',
            assignedUserId: null, // Unassigned
        },
        orderBy: { takeoverAt: 'asc' }, // Oldest first
        include: {
            messages: {
                take: 5,
                orderBy: { createdAt: 'desc' },
            },
        },
    });
}

/**
 * Assigns a conversation to a human agent
 */
export async function assignConversation(
    prisma: any,
    conversationId: string,
    userId: string
): Promise<{ success: boolean; error?: string }> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
    });

    if (!conversation) {
        return { success: false, error: 'Conversation not found' };
    }

    if (conversation.assignedUserId) {
        return { success: false, error: 'Conversation already assigned' };
    }

    await prisma.conversation.update({
        where: { id: conversationId },
        data: {
            assignedUserId: userId,
            assignedAt: new Date(),
        },
    });

    return { success: true };
}

// Export for testing
export const KEYWORDS = TAKEOVER_KEYWORDS;
export const FRUSTRATION = FRUSTRATION_INDICATORS;
