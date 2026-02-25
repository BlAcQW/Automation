'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import {
    Bell, Calendar, XCircle, MessageCircle, Info,
    Check, CheckCheck, Loader2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
    NEW_BOOKING: { icon: Calendar, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
    BOOKING_CANCELLED: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/30' },
    NEW_CONVERSATION: { icon: MessageCircle, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/30' },
    SYSTEM: { icon: Info, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/30' },
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

    // Poll unread count every 30 seconds
    useEffect(() => {
        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30000);
        return () => clearInterval(interval);
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
                className="relative p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
                <Bell className="w-5 h-5" />
                <AnimatePresence>
                    {unreadCount > 0 && (
                        <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-slate-900"
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
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden z-50"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">
                                Notifications
                            </h3>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllAsRead}
                                    disabled={markingAll}
                                    className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 font-medium disabled:opacity-50 transition-colors"
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
                                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                                </div>
                            ) : notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <Bell className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-600" />
                                    <p className="text-sm">No notifications yet</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                    {notifications.map((notification, index) => {
                                        const config = typeConfig[notification.type] || typeConfig.SYSTEM;
                                        const Icon = config.icon;

                                        return (
                                            <motion.button
                                                key={notification.id}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: index * 0.03 }}
                                                onClick={() => {
                                                    if (!notification.isRead) markAsRead(notification.id);
                                                }}
                                                className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${!notification.isRead
                                                    ? 'bg-emerald-50/50 dark:bg-emerald-900/10'
                                                    : ''
                                                    }`}
                                            >
                                                <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                                    <Icon className={`w-4 h-4 ${config.color}`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className={`text-sm font-medium truncate ${!notification.isRead
                                                            ? 'text-slate-900 dark:text-white'
                                                            : 'text-slate-600 dark:text-slate-400'
                                                            }`}>
                                                            {notification.title}
                                                        </p>
                                                        {!notification.isRead && (
                                                            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                                        {notification.message}
                                                    </p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
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
