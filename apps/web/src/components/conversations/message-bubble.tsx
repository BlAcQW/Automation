'use client';

import { useState } from 'react';

import { motion, useReducedMotion } from 'framer-motion';
import { SmilePlus } from 'lucide-react';
import { cn } from '@bookingflow/ui';
import type { Message } from './types';
import { formatTime, previewText } from './utils';
import { ChatMedia } from './chat-media';
import { ChatContact, ChatLocation } from './chat-rich';
import { DeliveryTicks } from './delivery-ticks';

/**
 * A single chat message bubble: the customer's on white (surface), the
 * business's in brand green with white text.
 */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function MessageBubble({
    message,
    index: _index,
    animate = false,
    conversationId,
    onReact,
}: {
    message: Message;
    index: number;
    /** Slide in gently (a message that arrived while the chat was open). */
    animate?: boolean;
    conversationId: string;
    onReact?: (messageId: string, emoji: string) => void;
}) {
    const reduce = useReducedMotion();
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
            initial={animate && !reduce ? { opacity: 0, y: 10, x: outbound ? 8 : -8 } : false}
            animate={{ opacity: 1, y: 0, x: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
                        className="flex h-9 w-9 items-center justify-center rounded-full text-muted opacity-0 transition-opacity duration-ui
                                   hover:bg-surface-2 hover:text-text group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
                    >
                        <SmilePlus className="h-4 w-4" />
                    </button>
                    {picking ? (
                        <div
                            className={cn(
                                'absolute bottom-full z-10 mb-1 flex gap-0.5 rounded-full border border-border bg-surface px-1.5 py-1 shadow-card-lg',
                                outbound ? 'right-0' : 'left-0',
                            )}
                        >
                            {QUICK_REACTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => { setPicking(false); onReact(message.id, emoji); }}
                                    aria-label={`React with ${emoji}`}
                                    className="flex h-10 w-10 items-center justify-center rounded-full text-xl leading-none transition-transform duration-ui hover:scale-110 hover:bg-surface-2"
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className={cn('max-w-[82%] sm:max-w-[70%]', outbound ? 'order-2' : 'order-1')}>
                <div
                    className={cn(
                        'whitespace-pre-wrap break-words px-3.5 py-2.5 text-[16px] leading-relaxed',
                        outbound
                            ? 'rounded-[18px] rounded-br-md bg-primary text-primary-fg shadow-soft'
                            : 'rounded-[18px] rounded-bl-md border border-border bg-surface text-text shadow-soft',
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
                        'mt-1 px-1 text-[12px] tabular-nums text-muted',
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
