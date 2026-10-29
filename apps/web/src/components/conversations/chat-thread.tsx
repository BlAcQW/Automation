'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Hand, MessageCircle, Phone, StickyNote, UserRound } from 'lucide-react';
import { Avatar, Button, Drawer, EmptyState, Skeleton, cn } from '@bookingflow/ui';
import { CustomerNotePanel } from '@/components/customers/customer-note-panel';
import type { Conversation, Message } from './types';
import { MessageBubble } from './message-bubble';
import { ChatComposer } from './chat-composer';
import { channelLabel, contactLine, conversationTitle } from './utils';

interface ChatThreadProps {
    conversation: Conversation;
    messages: Message[];
    loading: boolean;
    resuming: boolean;
    onBack: () => void;
    onResumeBot: () => void;
    onSend: (content: string) => Promise<void>;
    onSendMedia?: (file: File, caption: string) => Promise<void>;
    onReact?: (messageId: string, emoji: string) => void;
}

/** The right-hand chat panel: header, who's replying, message stream, composer. */
export function ChatThread({
    conversation,
    messages,
    loading,
    resuming,
    onBack,
    onResumeBot,
    onSend,
    onSendMedia,
    onReact,
}: ChatThreadProps) {
    const endRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLInputElement>(null);
    // Messages already on screen when the thread opened don't animate; only
    // ones that arrive while it's open slide in.
    const seenRef = useRef<Set<string> | null>(null);
    const [notesOpen, setNotesOpen] = useState(false);

    useEffect(() => {
        seenRef.current = null;
        setNotesOpen(false);
    }, [conversation.id]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        if (!loading) {
            const seen = seenRef.current ?? new Set<string>();
            messages.forEach((m) => seen.add(m.id));
            seenRef.current = seen;
        }
    }, [messages, loading]);

    const title = conversationTitle(conversation);
    const channel = channelLabel(conversation);
    const isHuman = conversation.state === 'HUMAN_ACTIVE';
    const seen = seenRef.current;

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border bg-surface px-2 py-2 sm:gap-3 sm:px-4">
                <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to conversations" className="md:hidden">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <Avatar name={conversation.customerName} size="md" status={isHuman ? 'busy' : 'online'} />
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[16px] font-bold text-text">{title}</h2>
                    <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                        {channel
                            ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold">{channel}</span>
                            : <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                        <span className="truncate tabular-nums">{contactLine(conversation)}</span>
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNotesOpen(true)}
                    aria-label="Notes about this customer"
                    className="shrink-0"
                >
                    <StickyNote className="h-4 w-4" aria-hidden />
                    <span className="hidden lg:inline">Notes</span>
                </Button>
                {isHuman ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onResumeBot}
                        isLoading={resuming}
                        loadingText="Handing back…"
                        className="shrink-0"
                    >
                        <Bot className="h-4 w-4" aria-hidden />
                        <span className="sm:hidden">Hand back</span>
                        <span className="hidden sm:inline">Hand back to assistant</span>
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        onClick={() => composerRef.current?.focus()}
                        className="shrink-0"
                        title="Your next message pauses the assistant so you can reply yourself"
                    >
                        <Hand className="h-4 w-4" aria-hidden />
                        Take over
                    </Button>
                )}
            </div>

            {/* Who's replying: always words + icon, never colour alone. */}
            <div
                role="status"
                className={cn(
                    'flex items-center gap-2 px-4 py-2 text-[14px] font-medium',
                    isHuman ? 'bg-warning-soft text-warning-fg' : 'bg-primary-soft text-primary',
                )}
            >
                {isHuman ? <UserRound className="h-4 w-4 shrink-0" aria-hidden /> : <Bot className="h-4 w-4 shrink-0" aria-hidden />}
                <span className="min-w-0">
                    {isHuman
                        ? 'You are replying. Your assistant is paused for this chat.'
                        : 'Your assistant is replying. Send a message to take over.'}
                </span>
            </div>

            {/* Messages */}
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain bg-bg p-3 sm:p-4" aria-busy={loading || undefined}>
                {loading ? (
                    <div className="space-y-3" aria-label="Loading messages">
                        {[52, 68, 40, 60].map((w, i) => (
                            <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
                                <Skeleton className="h-12 rounded-card" style={{ width: `${w}%` }} />
                            </div>
                        ))}
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <EmptyState
                            icon={<MessageCircle />}
                            title="No messages yet"
                            description="Say hello. Your message goes straight to their WhatsApp."
                        />
                    </div>
                ) : (
                    messages.map((m, i) => (
                        <MessageBubble
                            key={m.id}
                            message={m}
                            index={i}
                            animate={seen !== null && !seen.has(m.id)}
                            conversationId={conversation.id}
                            onReact={onReact}
                        />
                    ))
                )}
                <div ref={endRef} />
            </div>

            <ChatComposer onSend={onSend} onSendMedia={onSendMedia} inputRef={composerRef} />

            <Drawer isOpen={notesOpen} onClose={() => setNotesOpen(false)} title={`Notes on ${title}`}>
                <CustomerNotePanel conversationId={conversation.id} />
            </Drawer>
        </div>
    );
}
