export type ConversationState = 'BOT_ACTIVE' | 'HUMAN_ACTIVE';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export type ConversationChannel = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';

export interface Conversation {
    id: string;
    /** Absent on older API responses: treat as WhatsApp. */
    channel?: ConversationChannel;
    /** Instagram and Messenger give no phone number. */
    customerPhone: string | null;
    customerName: string | null;
    /** Instagram @username (masked like contacts for some staff). */
    customerHandle?: string | null;
    state: ConversationState;
    lastMessage?: string;
    lastMessageAt?: string;
    lastMessageDirection?: MessageDirection | null;
    updatedAt: string;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'sticker' | 'document';

export interface MessageMedia {
    kind?: MediaKind;
    mimeType?: string;
    size?: number;
    caption?: string;
    filename?: string | null;
    /** Inbound media we hold only a Meta id for — bytes not downloaded yet. */
    inboundPending?: boolean;
    voice?: boolean;
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
    contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
    phone?: string;
    emoji?: string;
}

export type MessageStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
    id: string;
    direction: MessageDirection;
    content: string;
    messageType: string;
    /** Present on media, location, contact and reaction messages. */
    metadata?: MessageMedia | null;
    /** Delivery state for OUTBOUND messages. */
    status?: MessageStatus | null;
    createdAt: string;
}

export type ChatFilter = 'all' | 'unread' | 'bot' | 'human';

/** A conversation "needs a reply" when the customer spoke last. */
export function isUnread(c: Conversation): boolean {
    return c.lastMessageDirection === 'INBOUND';
}
