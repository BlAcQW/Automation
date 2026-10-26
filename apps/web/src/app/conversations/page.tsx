'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, SearchX } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, EmptyState, SearchInput, Skeleton, buttonVariants, cn } from '@bookingflow/ui';
import { notify as toast } from '@/components/brand/toast';
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
                (c.customerPhone?.toLowerCase().includes(q) ?? false) ||
                (c.customerHandle?.toLowerCase().includes(q) ?? false) ||
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
            toast.error(err?.response?.data?.message ?? "Your message didn't send. Check your connection and try again.");
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
            toast.error(err?.response?.data?.message ?? "Your file didn't send. Try a smaller file or try again.");
            throw err;
        }
    };

    const react = async (messageId: string, emoji: string) => {
        if (!selectedId) return;
        try {
            await api.post(`/conversations/${selectedId}/rich`, { type: 'reaction', messageId, emoji });
            await queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? "Your reaction didn't send. Try again.");
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
            toast.success('Handed back. Your assistant is replying again.');
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? "Couldn't hand back to your assistant. Try again.");
        } finally {
            setResuming(false);
        }
    };

    const filterChips = [
        { value: 'all', label: 'All', count: counts.all },
        { value: 'unread', label: 'Unread', count: counts.unread },
        { value: 'bot', label: 'Assistant replying', count: counts.bot },
        { value: 'human', label: 'You replying', count: counts.human },
    ];

    return (
        <div
            className={cn(
                'flex overflow-hidden bg-surface',
                // Mobile: full-bleed like WhatsApp. Cancel <main>'s side and
                // top gutters; the height stops the panel above the bottom
                // tab bar (header 4rem + awning + main's bottom clearance).
                '-mx-4 -mt-5 h-[calc(100dvh-10.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] sm:-mx-6',
                // Desktop: a contained, rounded panel within normal padding.
                'lg:mx-0 lg:mt-0 lg:h-[calc(100dvh-10rem)] lg:min-h-[32rem] lg:rounded-card lg:border lg:border-border lg:shadow-card',
            )}
        >
            {/* Conversation list */}
            <aside
                aria-label="Chats"
                className={cn(
                    'flex w-full flex-col bg-surface md:w-[22rem] md:border-r md:border-border lg:w-96',
                    selectedConvo && 'hidden md:flex',
                )}
            >
                <div className="space-y-3 px-4 pb-3 pt-4">
                    <div className="flex items-baseline justify-between gap-3">
                        <h1 className="font-display text-page-title text-text">Inbox</h1>
                        <span className="text-[14px] tabular-nums text-muted">
                            {conversations.length} {conversations.length === 1 ? 'chat' : 'chats'}
                        </span>
                    </div>
                    <SearchInput
                        value={search}
                        onChange={setSearch}
                        label="Search chats"
                        placeholder="Search by name or number"
                    />
                    <ChatFilterChips chips={filterChips} active={filter} onChange={setFilter} />
                </div>

                <div className="flex-1 overflow-y-auto border-t border-border px-2 py-2">
                    {isLoading ? (
                        /* Shape, not a spinner: the placeholder is the list item's own
                           layout, so content fades in over it instead of snapping in. */
                        <ul className="space-y-1" aria-busy="true" aria-label="Loading conversations">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <li key={i} className="flex items-center gap-3 px-3 py-3">
                                    <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                                    <div className="flex-1 space-y-2">
                                        <div className="flex justify-between gap-3">
                                            <Skeleton className="h-4 w-2/5" />
                                            <Skeleton className="h-3 w-10" />
                                        </div>
                                        <Skeleton className="h-3 w-4/5" />
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
                        search || filter !== 'all' ? (
                            <EmptyState
                                icon={<SearchX />}
                                title="No chats match"
                                description="Try another name or number, or show all chats."
                                action={
                                    <Button variant="secondary" onClick={() => { setSearch(''); setFilter('all'); }}>
                                        Show all chats
                                    </Button>
                                }
                            />
                        ) : (
                            <EmptyState
                                icon={<MessageCircle />}
                                title="No chats yet"
                                description="When customers message your WhatsApp number, their chats land here."
                                action={<Link href="/channels" className={buttonVariants()}>Check your channels</Link>}
                            />
                        )
                    ) : (
                        <ul className="space-y-0.5">
                            {visibleConvos.map((convo, i) => (
                                <li key={convo.id}>
                                    <ConversationListItem
                                        conversation={convo}
                                        index={i}
                                        active={selectedId === convo.id}
                                        unread={isUnread(convo)}
                                        onClick={() => setSelectedId(convo.id)}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </aside>

            {/* Chat thread */}
            <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !selectedConvo && 'hidden md:flex')}>
                {/* On phones the list (and its h1) is hidden while a chat is open. */}
                {selectedConvo && <h1 className="sr-only md:hidden">Inbox</h1>}
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
                    <div className="flex flex-1 items-center justify-center bg-bg">
                        <EmptyState
                            icon={<MessageCircle />}
                            title="Pick a chat"
                            description="Choose a conversation on the left to read it and reply."
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
