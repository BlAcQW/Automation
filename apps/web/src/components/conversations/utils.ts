import type { Conversation } from './types';

/** WhatsApp-style relative timestamp for chat rows and message bubbles. */
export function formatTime(dateStr?: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days <= 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A short, human-readable preview for a message. Non-text WhatsApp messages
 * store placeholder content, so label them by type instead.
 */
export function previewText(messageType: string, content?: string): string {
    switch (messageType) {
        case 'IMAGE':
            return '📷 Photo';
        case 'DOCUMENT':
            return '📄 Document';
        case 'TEMPLATE':
            return content?.trim() || '📋 Template message';
        case 'INTERACTIVE':
            return content?.trim() || '⚡ Interactive message';
        default:
            return content?.trim() || '';
    }
}

/** Channel name for a conversation; null for WhatsApp (the default, shown without a label). */
export function channelLabel(c: Pick<Conversation, 'channel'>): string | null {
    if (c.channel === 'INSTAGRAM') return 'Instagram';
    if (c.channel === 'MESSENGER') return 'Messenger';
    return null;
}

/** How to reach the customer: phone on WhatsApp, @handle on Instagram, the channel name otherwise. */
export function contactLine(c: Pick<Conversation, 'channel' | 'customerPhone' | 'customerHandle'>): string {
    if (c.channel === 'INSTAGRAM' && c.customerHandle) return `@${c.customerHandle.replace(/^@/, '')}`;
    if (c.channel === 'INSTAGRAM' || c.channel === 'MESSENGER') return channelLabel(c)!;
    return c.customerPhone ?? '';
}

/** The name to show for a conversation. */
export function conversationTitle(c: Pick<Conversation, 'channel' | 'customerPhone' | 'customerHandle' | 'customerName'>): string {
    return c.customerName || contactLine(c) || 'Customer';
}
