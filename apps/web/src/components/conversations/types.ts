export type ConversationState = 'BOT_ACTIVE' | 'HUMAN_ACTIVE';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export interface Conversation {
    id: string;
    customerPhone: string;
    customerName: string | null;
    state: ConversationState;
    lastMessage?: string;
    lastMessageAt?: string;
    lastMessageDirection?: MessageDirection | null;
    updatedAt: string;
}

export interface Message {
    id: string;
    direction: MessageDirection;
    content: string;
    messageType: string;
    createdAt: string;
}

export type ChatFilter = 'all' | 'unread' | 'bot' | 'human';

/** A conversation "needs a reply" when the customer spoke last. */
export function isUnread(c: Conversation): boolean {
    return c.lastMessageDirection === 'INBOUND';
}
