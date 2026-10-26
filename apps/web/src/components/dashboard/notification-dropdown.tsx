'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import {
    Bell, Calendar, XCircle, MessageCircle, Info,
    Check, CheckCheck, Loader2
} from 'lucide-react';
import { Badge } from '@bookingflow/ui';

interface Notification {
    id: string;
    type: 'NEW_BOOKING' | 'BOOKING_CANCELLED' | 'NEW_CONVERSATION' | 'SYSTEM';
    title: string;
    message: string;
    isRead: boolean;
    metadata?: Record<string, any>;
    createdAt: string;
}

const typeConfig: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
    NEW_BOOKING: { icon: Calendar, color: 'text-forest-brand dark:text-bookly-emerald-300', bg: 'bg-bookly-emerald-100 dark:bg-bookly-emerald-500/20' },
    BOOKING_CANCELLED: { icon: XCircle, color: 'text-[#962F25] dark:text-[#F0B8B0]', bg: 'bg-[#F0D9D5] dark:bg-[#B03A2E]/25' },
    NEW_CONVERSATION: { icon: MessageCircle, color: 'text-[#2C4A63] dark:text-[#B9CCDD]', bg: 'bg-[#DDE4EA] dark:bg-[#2C4A63]/40' },
    SYSTEM: { icon: Info, color: 'text-[#7A5512] dark:text-forest-glow', bg: 'bg-[#F1E3C2] dark:bg-forest-glow/15' },
};

function timeAgo(date: string): string {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function NotificationDropdown() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Poll unread count every 30 seconds, but only while the tab is visible.
    // Background tabs and minimized windows shouldn't burn API requests.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        let interval: ReturnType<typeof setInterval> | null = null;
        const start = () => {
            if (interval !== null) return;
            fetchUnreadCount();
            interval = setInterval(fetchUnreadCount, 30000);
        };
        const stop = () => {
            if (interval !== null) {
                clearInterval(interval);
                interval = null;
            }
        };
        const onVisibilityChange = () => {
            document.visibilityState === 'visible' ? start() : stop();
        };
        if (document.visibilityState === 'visible') start();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    // Close on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchUnreadCount = async () => {
        try {
            const res = await api.get('/notifications/unread-count');
            setUnreadCount(res.data.count);
        } catch (err) {
            // Silently ignore — user might not be authenticated yet
        }
    };

    const fetchNotifications = async () => {
        setLoading(true);
        try {
            const res = await api.get('/notifications?limit=15');
            setNotifications(res.data.data);
        } catch (err) {
            console.error('Failed to fetch notifications:', err);
        } finally {
            setLoading(false);
        }
    };

    const toggleOpen = () => {
        const willOpen = !isOpen;
        setIsOpen(willOpen);
        if (willOpen) fetchNotifications();
    };

    const markAsRead = async (id: string) => {
        try {
            await api.patch(`/notifications/${id}/read`);
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
            console.error('Failed to mark notification as read:', err);
        }
    };

    const markAllAsRead = async () => {
        setMarkingAll(true);
        try {
            await api.post('/notifications/mark-all-read');
            setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
            setUnreadCount(0);
        } catch (err) {
            console.error('Failed to mark all as read:', err);
        } finally {
            setMarkingAll(false);
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={toggleOpen}
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                aria-expanded={isOpen}
                className="relative flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-text/[0.06] hover:text-text transition-colors"
            >
                <Bell className="w-5 h-5" />
                <AnimatePresence>
                    {unreadCount > 0 && (
                        <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-error text-white text-[11px] font-semibold tabular-nums rounded-full flex items-center justify-center ring-2 ring-bg"
                        >
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </motion.span>
                    )}
                </AnimatePresence>
            </button>

            {/* Dropdown Panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        className="absolute right-0 top-full mt-2 w-[min(360px,calc(100vw-2rem))] max-h-[480px] bg-white dark:bg-ink-900 rounded-2xl shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.08),0_30px_60px_-30px_rgba(20,26,22,0.55)] overflow-hidden z-50 origin-top-right"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-50/[0.08]">
                            <h3 className="text-[15px] font-medium tracking-[-0.02em] text-ink-50">
                                Notifications
                            </h3>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllAsRead}
                                    disabled={markingAll}
                                    className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-forest-brand dark:text-bookly-emerald-300 hover:bg-ink-50/[0.05] font-medium disabled:opacity-50 transition-colors"
                                >
                                    {markingAll ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <CheckCheck className="w-3.5 h-3.5" />
                                    )}
                                    Mark all read
                                </button>
                            )}
                        </div>

                        {/* Notification List */}
                        <div className="overflow-y-auto max-h-[400px]">
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-5 h-5 animate-spin text-ink-400" />
                                </div>
                            ) : notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-ink-400">
                                    <Bell className="w-8 h-8 mb-2 text-ink-600" strokeWidth={1.5} />
                                    <p className="text-sm">No notifications yet</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-ink-50/[0.06]">
                                    {notifications.map((notification, index) => {
                                        const config = typeConfig[notification.type] || typeConfig.SYSTEM;
                                        const Icon = config.icon;

                                        return (
                                            <motion.button
                                                key={notification.id}
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: index * 0.03 }}
                                                onClick={() => {
                                                    if (!notification.isRead) markAsRead(notification.id);
                                                }}
                                                className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-ink-50/[0.04] transition-colors ${!notification.isRead
                                                    ? 'bg-bookly-emerald-50/70 dark:bg-white/[0.03]'
                                                    : ''
                                                    }`}
                                            >
                                                <div className={`w-8 h-8 rounded ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                                    <Icon className={`w-4 h-4 ${config.color}`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className={`text-sm font-medium truncate ${!notification.isRead
                                                            ? 'text-ink-50'
                                                            : 'text-ink-300'
                                                            }`}>
                                                            {notification.title}
                                                        </p>
                                                        {!notification.isRead && (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-forest-brand dark:bg-forest-glow flex-shrink-0" />
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-ink-300 mt-0.5 line-clamp-2">
                                                        {notification.message}
                                                    </p>
                                                    <p className="text-[11px] text-ink-400 mt-1 tabular-nums">
                                                        {timeAgo(notification.createdAt)}
                                                    </p>
                                                </div>
                                            </motion.button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
