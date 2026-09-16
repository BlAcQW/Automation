'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ConversationListItem } from '@/components/conversations/conversation-list-item';
import { ChatFilterChips } from '@/components/conversations/chat-filter-chips';
import { ChatThread } from '@/components/conversations/chat-thread';
import { QueryState } from '@/components/query-state';
import { isUnread, type ChatFilter, type Conversation, type Message } from '@/components/conversations/types';

export default function ConversationsPage() {
    const queryClient = useQueryClient();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<ChatFilter>('all');
    const [resuming, setResuming] = useState(false);

    // Conversation list — polls every 10s so the inbox stays live.
    const { data: conversations = [], isLoading, isError } = useQuery<Conversation[]>({
        queryKey: ['conversations'],
        queryFn: async () => (await api.get('/conversations')).data.data,
        refetchInterval: 10_000,
    });

    // Open thread's messages — polls faster (5s) while a chat is open.
    const { data: messages = [], isLoading: messagesLoading, isError: messagesError } = useQuery<Message[]>({
        queryKey: ['conversation-messages', selectedId],
        queryFn: async () => (await api.get(`/conversations/${selectedId}/messages`)).data.data,
        enabled: !!selectedId,
        refetchInterval: 5_000,
    });

    const selectedConvo = conversations.find((c) => c.id === selectedId) ?? null;

    const counts = useMemo(() => {
        return {
            all: conversations.length,
            unread: conversations.filter(isUnread).length,
            bot: conversations.filter((c) => c.state === 'BOT_ACTIVE').length,
            human: conversations.filter((c) => c.state === 'HUMAN_ACTIVE').length,
        } satisfies Record<ChatFilter, number>;
    }, [conversations]);

    const visibleConvos = useMemo(() => {
        const q = search.trim().toLowerCase();
        return conversations.filter((c) => {
            if (filter === 'unread' && !isUnread(c)) return false;
            if (filter === 'bot' && c.state !== 'BOT_ACTIVE') return false;
            if (filter === 'human' && c.state !== 'HUMAN_ACTIVE') return false;
            if (!q) return true;
            return (
                c.customerPhone.toLowerCase().includes(q) ||
                (c.customerName?.toLowerCase().includes(q) ?? false)
            );
        });
    }, [conversations, filter, search]);

    const sendMessage = async (content: string) => {
        if (!selectedId) return;
        try {
            await api.post(`/conversations/${selectedId}/messages`, { content });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] }),
                queryClient.invalidateQueries({ queryKey: ['conversations'] }),
            ]);
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Failed to send message');
            throw err;
        }
    };

    const sendMedia = async (file: File, caption: string) => {
        if (!selectedId) return;
        const form = new FormData();
        form.append('file', file);
        if (caption) form.append('caption', caption);
        try {
            // Let the browser set Content-Type so the multipart boundary is
            // included; overriding it here breaks the upload.
            await api.post(`/conversations/${selectedId}/media`, form, { timeout: 60_000 });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] }),
                queryClient.invalidateQueries({ queryKey: ['conversations'] }),
            ]);
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Failed to send attachment');
            throw err;
        }
    };

    const react = async (messageId: string, emoji: string) => {
        if (!selectedId) return;
        try {
            await api.post(`/conversations/${selectedId}/rich`, { type: 'reaction', messageId, emoji });
            await queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Failed to send reaction');
        }
    };

    // --- Not shipped yet. See futurefeature.md items 3, 5 and 7. ------------
    // Location needs no extra package in the browser — navigator.geolocation
    // is built in — so this handler works as written once the button is back.
    // /**
    // * Location send — works as written; browsers expose geolocation
    // * browsers expose geolocation natively. Flipping the flag is all it needs.
    // */
    // const sendLocation = async () => {
    // if (!selectedId) return;
    // if (!navigator.geolocation) {
    // toast.error('This browser cannot share a location');
    // return;
    // }
    // navigator.geolocation.getCurrentPosition(
    // async (pos) => {
    // try {
    // await api.post(`/conversations/${selectedId}/rich`, {
    // type: 'location',
    // latitude: pos.coords.latitude,
    // longitude: pos.coords.longitude,
    // });
    // await queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] });
    // } catch (err: any) {
    // toast.error(err?.response?.data?.message ?? 'Failed to share location');
    // }
    // },
    // () => toast.error('Location permission denied'),
    // { enableHighAccuracy: true, timeout: 10_000 },
    // );
    // };
    //
    // /** Contact send — needs a proper name/phone form, not a prompt. */
    // const sendContact = async () => {
    // toast('Contact sharing needs a name and phone form (see futurefeature.md)');
    // };
    //
    // /** Address request — not implemented server-side yet. */
    // const requestAddress = async () => {
    // toast('Address requests are not built yet (see futurefeature.md)');
    // };
    // ------------------------------------------------------------------------

    const resumeBot = async () => {
        if (!selectedId) return;
        setResuming(true);
        try {
            await api.post(`/conversations/${selectedId}/resume-bot`);
            await queryClient.invalidateQueries({ queryKey: ['conversations'] });
            toast.success('Bot resumed');
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Failed to resume bot');
        } finally {
            setResuming(false);
        }
    };

    return (
        <div
            className={cn(
                'flex overflow-hidden bg-white dark:bg-slate-900',
                // Mobile: full-bleed like WhatsApp — cancel the dashboard
                // <main> side/top gutters, no border. Height = viewport minus
                // the header (4rem) and main's bottom clearance (7.5rem), so
                // the panel always stops above the floating tab bar.
                '-mx-4 -mt-4 h-[calc(100dvh-11.5rem)]',
                // Desktop: a contained, rounded panel within normal padding.
                'lg:mx-0 lg:mt-0 lg:h-[calc(100vh-7rem)] lg:rounded-2xl lg:border lg:border-slate-200 lg:dark:border-slate-800 lg:shadow-card',
            )}
        >
            {/* Conversation list */}
            <aside
                className={cn(
                    'w-full md:w-[22rem] lg:w-96 flex flex-col bg-white dark:bg-slate-900 md:border-r border-slate-200 dark:border-slate-800',
                    selectedConvo && 'hidden md:flex',
                )}
            >
                <div className="px-4 pt-4 pb-2 space-y-3">
                    <div className="flex items-baseline justify-between">
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Chats</h1>
                        <span className="text-xs text-slate-400">{conversations.length} total</span>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search chats…"
                            className="w-full h-11 pl-10 pr-4 rounded-full bg-slate-100 dark:bg-slate-800 border-0 text-sm
                                       text-slate-900 dark:text-white placeholder:text-slate-400
                                       focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        />
                    </div>
                    <ChatFilterChips active={filter} counts={counts} onChange={setFilter} />
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                    {isLoading ? (
                        /* Shape, not a spinner: the placeholder is the list item's own
                           layout, so content fades in over it instead of snapping in. */
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800" aria-busy="true" aria-label="Loading conversations">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <li key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                                    <div className="w-12 h-12 shrink-0 rounded-full bg-slate-200 dark:bg-slate-800" />
                                    <div className="flex-1 space-y-2">
                                        <div className="flex justify-between">
                                            <div className="h-3.5 w-2/5 rounded bg-slate-200 dark:bg-slate-800" />
                                            <div className="h-3 w-10 rounded bg-slate-200 dark:bg-slate-800" />
                                        </div>
                                        <div className="h-3 w-4/5 rounded bg-slate-200 dark:bg-slate-800" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : isError ? (
                        /* Never let a failed request render as "No conversations yet" —
                           a business with 200 chats would read that as data loss. */
                        <QueryState
                            isLoading={false}
                            isError
                            onRetry={() => queryClient.invalidateQueries({ queryKey: ['conversations'] })}
                        >
                            <></>
                        </QueryState>
                    ) : visibleConvos.length === 0 ? (
                        <div className="flex flex-col items-center text-center py-12 px-6">
                            <MessageCircle className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-3" />
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {search || filter !== 'all' ? 'No chats match your filter' : 'No conversations yet'}
                            </p>
                        </div>
                    ) : (
                        visibleConvos.map((convo, i) => (
                            <ConversationListItem
                                key={convo.id}
                                conversation={convo}
                                index={i}
                                active={selectedId === convo.id}
                                unread={isUnread(convo)}
                                onClick={() => setSelectedId(convo.id)}
                            />
                        ))
                    )}
                </div>
            </aside>

            {/* Chat thread */}
            <div className={cn('flex-1 flex flex-col min-w-0', !selectedConvo && 'hidden md:flex')}>
                {selectedConvo ? (
                    <ChatThread
                        conversation={selectedConvo}
                        messages={messages}
                        loading={messagesLoading}
                        resuming={resuming}
                        onBack={() => setSelectedId(null)}
                        onResumeBot={resumeBot}
                        onSend={sendMessage}
                        onSendMedia={sendMedia}
                        onReact={react}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                        <div className="text-center">
                            <MessageCircle className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                            <p className="text-slate-500 dark:text-slate-400">Select a conversation to start chatting</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
