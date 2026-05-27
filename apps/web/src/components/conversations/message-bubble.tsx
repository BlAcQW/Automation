'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';
import type { Message } from './types';
import { formatTime, previewText } from './utils';

/** A single chat message bubble — emerald for outbound, white for inbound. */
export function MessageBubble({ message, index }: { message: Message; index: number }) {
    const outbound = message.direction === 'OUTBOUND';
    const text = previewText(message.messageType, message.content);

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.02, 0.3) }}
            className={cn('flex', outbound ? 'justify-end' : 'justify-start')}
        >
            <div className="max-w-[78%]">
                <div
                    className={cn(
                        'px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap',
                        outbound
                            ? 'bg-gradient-to-br from-bookly-emerald-500 to-bookly-emerald-600 text-ink-1000 rounded-2xl rounded-br-md shadow-sm'
                            : 'bg-ink-900 text-ink-50 rounded-2xl rounded-bl-md border border-ink-700/70 shadow-sm',
                    )}
                >
                    {text}
                </div>
                <div
                    className={cn(
                        'mt-1 px-1 text-[11px] text-slate-400',
                        outbound ? 'text-right' : 'text-left',
                    )}
                >
                    {formatTime(message.createdAt)}
                </div>
            </div>
        </motion.div>
    );
}
