'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Search, Send, User, Phone, Clock, Bot, ArrowLeft, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface Message {
    id: string;
    direction: 'INBOUND' | 'OUTBOUND';
    content: string;
    messageType: string;
    createdAt: string;
    isFromBot: boolean;
}

interface Conversation {
    id: string;
    customerPhone: string;
    customerName: string | null;
    state: 'BOT_ACTIVE' | 'HUMAN_ACTIVE';
    lastMessageAt: string;
    _count?: { messages: number };
}

export default function ConversationsPage() {
    const { tenant } = useAuth();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [search, setSearch] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { fetchConversations(); }, []);
    useEffect(() => { if (selectedConvo) fetchMessages(selectedConvo.id); }, [selectedConvo]);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const fetchConversations = async () => {
        try {
            const response = await api.get('/conversations');
            setConversations(response.data.data);
        } catch (err) { console.error('Failed to fetch conversations:', err); }
        finally { setLoading(false); }
    };

    const fetchMessages = async (conversationId: string) => {
        setLoadingMessages(true);
        try {
            const response = await api.get(`/conversations/${conversationId}/messages`);
            setMessages(response.data.data);
        } catch (err) { console.error('Failed to fetch messages:', err); }
        finally { setLoadingMessages(false); }
    };

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedConvo) return;
        setSending(true);
        try {
            await api.post(`/conversations/${selectedConvo.id}/messages`, { content: newMessage });
            setNewMessage('');
            fetchMessages(selectedConvo.id);
        } catch (err) { console.error('Failed to send message:', err); }
        finally { setSending(false); }
    };

    const resumeBot = async () => {
        if (!selectedConvo) return;
        try {
            await api.post(`/conversations/${selectedConvo.id}/resume-bot`);
            fetchConversations();
            setSelectedConvo({ ...selectedConvo, state: 'BOT_ACTIVE' });
        } catch (err) { console.error('Failed to resume bot:', err); }
    };

    const filteredConvos = conversations.filter(c =>
        c.customerPhone.includes(search) || c.customerName?.toLowerCase().includes(search.toLowerCase())
    );

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        if (days === 1) return 'Yesterday';
        if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="h-[calc(100vh-8rem)] flex rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            {/* Conversations List */}
            <div className={cn('w-full md:w-96 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800', selectedConvo && 'hidden md:flex')}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Conversations</h1>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-slate-100 dark:bg-slate-700/50 border-0 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                        </div>
                    ) : filteredConvos.length === 0 ? (
                        <div className="p-8 text-center">
                            <MessageCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                            <p className="text-slate-500 dark:text-slate-400 text-sm">
                                {search ? 'No conversations found' : 'No conversations yet'}
                            </p>
                        </div>
                    ) : (
                        filteredConvos.map((convo) => (
                            <button
                                key={convo.id}
                                onClick={() => setSelectedConvo(convo)}
                                className={cn(
                                    'w-full p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-100 dark:border-slate-800 text-left transition-colors',
                                    selectedConvo?.id === convo.id && 'bg-emerald-50 dark:bg-emerald-900/20'
                                )}
                            >
                                <Avatar
                                    name={convo.customerName}
                                    size="md"
                                    status={convo.state === 'BOT_ACTIVE' ? 'online' : 'busy'}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="font-medium text-sm text-slate-900 dark:text-white truncate">
                                            {convo.customerName || convo.customerPhone}
                                        </span>
                                        <span className="text-[11px] text-slate-400">{formatTime(convo.lastMessageAt)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1">{convo.customerPhone}</p>
                                        <Badge variant={convo.state === 'BOT_ACTIVE' ? 'default' : 'yellow'} className="text-[10px] py-0">
                                            {convo.state === 'BOT_ACTIVE' ? 'Bot' : 'Human'}
                                        </Badge>
                                    </div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Chat View */}
            <div className={cn('flex-1 flex flex-col', !selectedConvo && 'hidden md:flex')}>
                {selectedConvo ? (
                    <>
                        {/* Chat Header */}
                        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 bg-white dark:bg-slate-800">
                            <button
                                onClick={() => setSelectedConvo(null)}
                                className="md:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </button>
                            <Avatar name={selectedConvo.customerName} size="sm" />
                            <div className="flex-1 min-w-0">
                                <h2 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                                    {selectedConvo.customerName || selectedConvo.customerPhone}
                                </h2>
                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                    <Phone className="w-3 h-3" /> {selectedConvo.customerPhone}
                                </div>
                            </div>
                            {selectedConvo.state === 'HUMAN_ACTIVE' && (
                                <Button size="sm" onClick={resumeBot}>
                                    <Bot className="w-4 h-4" /> Resume Bot
                                </Button>
                            )}
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-900/50">
                            {loadingMessages ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="text-center py-8 text-slate-500 text-sm">No messages yet</div>
                            ) : (
                                messages.map((msg, i) => (
                                    <motion.div
                                        key={msg.id}
                                        initial={{ opacity: 0, y: 5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.02 }}
                                        className={cn('flex', msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start')}
                                    >
                                        <div className="max-w-[75%]">
                                            <div className={cn(
                                                'px-4 py-2.5 rounded-2xl text-sm',
                                                msg.direction === 'OUTBOUND'
                                                    ? 'bg-emerald-500 text-white rounded-tr-md'
                                                    : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-tl-md shadow-sm border border-slate-200/50 dark:border-slate-700/50'
                                            )}>
                                                {msg.content}
                                            </div>
                                            <div className={cn('flex items-center gap-1 mt-1 text-[11px] text-slate-400', msg.direction === 'OUTBOUND' && 'justify-end')}>
                                                {msg.isFromBot && <Bot className="w-3 h-3" />}
                                                <Clock className="w-3 h-3" />
                                                {formatTime(msg.createdAt)}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Message Input */}
                        <form onSubmit={sendMessage} className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Type a message..."
                                    className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-700/50 border-0 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                />
                                <Button type="submit" disabled={!newMessage.trim() || sending} size="icon">
                                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                </Button>
                            </div>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900/50">
                        <div className="text-center">
                            <MessageCircle className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                            <p className="text-slate-500 dark:text-slate-400">Select a conversation to view messages</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
