'use client';

import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import type { Conversation } from './types';
import { formatTime, previewText } from './utils';

interface ConversationListItemProps {
    conversation: Conversation;
    active: boolean;
    unread: boolean;
    onClick: () => void;
}

/** A single row in the chat list — avatar, name, preview, time, unread dot. */
export function ConversationListItem({ conversation, active, unread, onClick }: ConversationListItemProps) {
    const title = conversation.customerName || conversation.customerPhone;
    const preview = conversation.lastMessage
        ? previewText('TEXT', conversation.lastMessage)
        : conversation.customerPhone;

    return (
        <button
            onClick={onClick}
            className={cn(
                'w-full flex items-center gap-3 px-3 py-3 text-left rounded-2xl transition-colors',
                active
                    ? 'bg-emerald-50 dark:bg-emerald-900/20'
                    : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/60 active:bg-slate-100 dark:active:bg-slate-800',
            )}
        >
            <Avatar
                name={conversation.customerName}
                size="lg"
                status={conversation.state === 'BOT_ACTIVE' ? 'online' : 'busy'}
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'flex-1 min-w-0 truncate text-sm',
                            unread
                                ? 'font-bold text-slate-900 dark:text-white'
                                : 'font-semibold text-slate-800 dark:text-slate-100',
                        )}
                    >
                        {title}
                    </span>
                    <span
                        className={cn(
                            'shrink-0 text-[11px]',
                            unread ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-400',
                        )}
                    >
                        {formatTime(conversation.lastMessageAt)}
                    </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                    <p
                        className={cn(
                            'flex-1 min-w-0 truncate text-xs',
                            unread
                                ? 'text-slate-600 dark:text-slate-300'
                                : 'text-slate-400 dark:text-slate-500',
                        )}
                    >
                        {preview}
                    </p>
                    {unread && (
                        <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-emerald-500" aria-label="Unread" />
                    )}
                </div>
            </div>
        </button>
    );
}
