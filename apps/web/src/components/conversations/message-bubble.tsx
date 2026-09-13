'use client';

import { useState } from 'react';

import { motion } from 'framer-motion';
import { SmilePlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Message } from './types';
import { formatTime, previewText } from './utils';
import { ChatMedia } from './chat-media';
import { ChatContact, ChatLocation } from './chat-rich';
import { DeliveryTicks } from './delivery-ticks';

/** A single chat message bubble — emerald for outbound, white for inbound. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function MessageBubble({
    message,
    index,
    conversationId,
    onReact,
}: {
    message: Message;
    index: number;
    conversationId: string;
    onReact?: (messageId: string, emoji: string) => void;
}) {
    const [picking, setPicking] = useState(false);
    const outbound = message.direction === 'OUTBOUND';
    const type = message.messageType ?? 'TEXT';
    const hasMedia = ['IMAGE', 'VIDEO', 'AUDIO', 'STICKER', 'DOCUMENT'].includes(type);
    const isLocation = type === 'LOCATION';
    const isContact = type === 'CONTACT';
    const isReaction = type === 'REACTION';
    const structured = hasMedia || isLocation || isContact;
    const text = previewText(message.messageType, message.content);

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.02, 0.3) }}
            className={cn('group flex items-center gap-1.5', outbound ? 'justify-end' : 'justify-start')}
            onMouseLeave={() => setPicking(false)}
        >
            {/* React control sits outside the bubble, on the side the bubble
                isn't anchored to, so it never covers the message text. */}
            {onReact && !isReaction ? (
                <div className={cn('relative order-2', outbound && 'order-1')}>
                    <button
                        type="button"
                        onClick={() => setPicking((v) => !v)}
                        aria-label="React to this message"
                        aria-expanded={picking}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100
                                   transition-opacity p-1 rounded-full"
                    >
                        <SmilePlus className="w-4 h-4" />
                    </button>
                    {picking ? (
                        <div className="absolute bottom-full z-10 mb-1 flex gap-1 rounded-full border
                                        border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800
                                        px-2 py-1 shadow-lg">
                            {QUICK_REACTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => { setPicking(false); onReact(message.id, emoji); }}
                                    aria-label={`React with ${emoji}`}
                                    className="text-lg leading-none transition-transform hover:scale-125"
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className={cn('max-w-[78%]', outbound ? 'order-2' : 'order-1')}>
                <div
                    className={cn(
                        'px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap',
                        outbound
                            ? 'bg-gradient-to-br from-bookly-emerald-500 to-bookly-emerald-600 text-ink-1000 rounded-2xl rounded-br-md shadow-sm'
                            : 'bg-ink-900 text-ink-50 rounded-2xl rounded-bl-md border border-ink-700/70 shadow-sm',
                    )}
                >
                    {hasMedia ? <ChatMedia message={message} conversationId={conversationId} /> : null}
                    {isLocation ? <ChatLocation message={message} /> : null}
                    {isContact ? <ChatContact message={message} /> : null}
                    {/* A caption-less attachment stores a placeholder such as
                        "[image]" as its content — noise under the picture. */}
                    {!structured || message.metadata?.caption ? (
                        <div className={cn(structured && 'mt-1.5', isReaction && 'text-3xl leading-none')}>
                            {structured ? message.metadata?.caption : text}
                        </div>
                    ) : null}
                </div>
                <div
                    className={cn(
                        'mt-1 px-1 text-[11px] text-slate-400',
                        outbound ? 'text-right' : 'text-left',
                    )}
                >
                    <span className="inline-flex items-center gap-1">
                        {formatTime(message.createdAt)}
                        {outbound ? <DeliveryTicks status={message.status} /> : null}
                    </span>
                </div>
            </div>
        </motion.div>
    );
}
