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
