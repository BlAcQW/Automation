'use client';

import { motion, useReducedMotion } from 'framer-motion';

import { cn, Avatar } from '@bookingflow/ui';
import type { Conversation } from './types';
import { channelLabel, contactLine, conversationTitle, formatTime, previewText } from './utils';

interface ConversationListItemProps {
    /** Position in the list, for the staggered entrance. */
    index?: number;
    conversation: Conversation;
    active: boolean;
    unread: boolean;
    onClick: () => void;
}

/** A single row in the chat list — avatar, name, preview, time, unread dot. */
export function ConversationListItem({ index = 0, conversation, active, unread, onClick }: ConversationListItemProps) {
    const reduce = useReducedMotion();
    const title = conversationTitle(conversation);
    const channel = channelLabel(conversation);
    const isHuman = conversation.state === 'HUMAN_ACTIVE';
    const preview = conversation.lastMessage
        ? previewText('TEXT', conversation.lastMessage)
        : contactLine(conversation);

    return (
        <motion.button
            type="button"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.06, 0.36) }}
            onClick={onClick}
            aria-current={active ? 'true' : undefined}
            className={cn(
                'relative flex min-h-[64px] w-full items-center gap-3 rounded-control px-3 py-3 text-left transition-colors duration-ui',
                active ? 'bg-primary-soft' : 'hover:bg-surface-2 active:bg-surface-2',
            )}
        >
            {active && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-primary" />}
            <Avatar name={conversation.customerName} size="lg" status={isHuman ? 'busy' : 'online'} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'min-w-0 flex-1 truncate text-[16px]',
                            unread ? 'font-bold text-text' : 'font-medium text-text',
                        )}
                    >
                        {title}
                    </span>
                    {channel && (
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-muted">
                            {channel}
                        </span>
                    )}
                    <span
                        className={cn(
                            'shrink-0 text-[13px] tabular-nums',
                            unread ? 'font-semibold text-primary' : 'text-muted',
                        )}
                    >
                        {formatTime(conversation.lastMessageAt)}
                    </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                    <p className={cn('min-w-0 flex-1 truncate text-[14px]', unread ? 'text-text' : 'text-muted')}>
                        {preview}
                    </p>
                    {isHuman && (
                        <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning-fg">
                            You
                        </span>
                    )}
                    {unread && (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                    )}
                </div>
            </div>
        </motion.button>
    );
}
