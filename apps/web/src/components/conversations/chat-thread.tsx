'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft, Bot, Phone, Loader2, MessageCircle } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import type { Conversation, Message } from './types';
import { MessageBubble } from './message-bubble';
import { ChatComposer } from './chat-composer';

interface ChatThreadProps {
    conversation: Conversation;
    messages: Message[];
    loading: boolean;
    resuming: boolean;
    onBack: () => void;
    onResumeBot: () => void;
    onSend: (content: string) => Promise<void>;
}

/** The right-hand chat panel: header, message stream, composer. */
export function ChatThread({
    conversation,
    messages,
    loading,
    resuming,
    onBack,
    onResumeBot,
    onSend,
}: ChatThreadProps) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const title = conversation.customerName || conversation.customerPhone;
    const isHuman = conversation.state === 'HUMAN_ACTIVE';

    return (
        <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <button
                    onClick={onBack}
                    aria-label="Back to conversations"
                    className="md:hidden -ml-1 p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar name={conversation.customerName} size="md" status={isHuman ? 'busy' : 'online'} />
                <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-sm text-slate-900 dark:text-white truncate">{title}</h2>
                    <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span className="truncate">{conversation.customerPhone}</span>
                        <span
                            className={cn(
                                'ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                isHuman
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                            )}
                        >
                            {isHuman ? 'Human' : 'Bot'}
                        </span>
                    </p>
                </div>
                {isHuman && (
                    <button
                        onClick={onResumeBot}
                        disabled={resuming}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold
                                   bg-slate-900 text-white dark:bg-white dark:text-slate-900
                                   hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                        {resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                        Resume Bot
                    </button>
                )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 bg-slate-50 dark:bg-slate-950">
                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
                        <MessageCircle className="w-10 h-10 mb-2 text-slate-300 dark:text-slate-700" />
                        <p className="text-sm">No messages yet</p>
                    </div>
                ) : (
                    messages.map((m, i) => <MessageBubble key={m.id} message={m} index={i} />)
                )}
                <div ref={endRef} />
            </div>

            <ChatComposer onSend={onSend} />
        </div>
    );
}
