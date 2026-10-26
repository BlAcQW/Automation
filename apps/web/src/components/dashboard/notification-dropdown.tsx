'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { api } from '@/lib/api';
import { Bell, Calendar, XCircle, Inbox, Info, CheckCheck, Loader2 } from 'lucide-react';
import { Skeleton } from '@bookingflow/ui';

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
    NEW_BOOKING: { icon: Calendar, color: 'text-success-fg', bg: 'bg-success-soft' },
    BOOKING_CANCELLED: { icon: XCircle, color: 'text-error-fg', bg: 'bg-error-soft' },
    NEW_CONVERSATION: { icon: Inbox, color: 'text-primary', bg: 'bg-primary-soft' },
    SYSTEM: { icon: Info, color: 'text-warning-fg', bg: 'bg-warning-soft' },
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
    const reduce = useReducedMotion();

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
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute right-0 top-full z-50 mt-2 max-h-[480px] w-[min(380px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-card border border-border bg-surface text-text shadow-card-lg"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                            <h3 className="text-base font-bold text-text">Notifications</h3>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllAsRead}
                                    disabled={markingAll}
                                    className="flex min-h-[44px] items-center gap-1.5 rounded-control px-2.5 text-[14px] font-semibold text-primary transition-colors duration-ui hover:bg-primary-soft disabled:opacity-50"
                                >
                                    {markingAll ? (
                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                    ) : (
                                        <CheckCheck className="h-4 w-4" aria-hidden />
                                    )}
                                    Mark all as read
                                </button>
                            )}
                        </div>

                        {/* Notification List */}
                        <div className="max-h-[400px] overflow-y-auto">
                            {loading ? (
                                <div aria-busy="true" className="divide-y divide-border">
                                    <span className="sr-only">Loading…</span>
                                    {[0, 1, 2].map((i) => (
                                        <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                                            <Skeleton className="h-9 w-9 shrink-0 rounded-control" />
                                            <div className="flex-1 space-y-2">
                                                <Skeleton className="h-3.5 w-2/3" />
                                                <Skeleton className="h-3 w-full" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                                    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted" aria-hidden>
                                        <Bell className="h-6 w-6" strokeWidth={1.75} />
                                    </span>
                                    <p className="text-base font-semibold text-text">You&apos;re all caught up</p>
                                    <p className="mt-1 text-[14px] text-muted">New bookings and messages will show up here.</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border">
                                    {notifications.map((notification, index) => {
                                        const config = typeConfig[notification.type] || typeConfig.SYSTEM;
                                        const Icon = config.icon;

                                        return (
                                            <motion.button
                                                key={notification.id}
                                                initial={reduce ? false : { opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: index * 0.05, duration: 0.2 }}
                                                onClick={() => {
                                                    if (!notification.isRead) markAsRead(notification.id);
                                                }}
                                                className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-ui hover:bg-surface-2 ${!notification.isRead
                                                    ? 'bg-primary-soft/40'
                                                    : ''
                                                    }`}
                                            >
                                                <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control ${config.bg}`}>
                                                    <Icon className={`h-[18px] w-[18px] ${config.color}`} aria-hidden />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className={`truncate text-[15px] ${!notification.isRead
                                                            ? 'font-semibold text-text'
                                                            : 'font-medium text-muted'
                                                            }`}>
                                                            {notification.title}
                                                        </p>
                                                        {!notification.isRead && (
                                                            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-fg">
                                                                New
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-muted">
                                                        {notification.message}
                                                    </p>
                                                    <p className="mt-1 text-[13px] tabular-nums text-muted">
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
