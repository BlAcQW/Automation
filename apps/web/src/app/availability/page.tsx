'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';
import { Clock, Save, Loader2, Plus, Trash2, CalendarOff } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { DashboardInput } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface WorkingHours {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
}

interface BlackoutDate {
    id: string;
    date: string;
    reason: string | null;
}

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AvailabilityPage() {
    const { tenant } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hours, setHours] = useState<{ [key: number]: { enabled: boolean; start: string; end: string } }>({});
    const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
    const [showBlackoutModal, setShowBlackoutModal] = useState(false);
    const [blackoutDate, setBlackoutDate] = useState('');
    const [blackoutReason, setBlackoutReason] = useState('');
    const [savingBlackout, setSavingBlackout] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [hoursRes, blackoutsRes] = await Promise.all([
                api.get('/availability/hours'),
                api.get('/availability/blackouts'),
            ]);

            const hoursMap: { [key: number]: { enabled: boolean; start: string; end: string } } = {};
            for (let i = 0; i < 7; i++) {
                hoursMap[i] = { enabled: false, start: '09:00', end: '17:00' };
            }

            hoursRes.data.data.forEach((h: WorkingHours) => {
                hoursMap[h.dayOfWeek] = { enabled: h.isActive, start: h.startTime, end: h.endTime };
            });

            setHours(hoursMap);
            setBlackouts(blackoutsRes.data.data);
        } catch (err) {
            console.error('Failed to fetch availability:', err);
        } finally {
            setLoading(false);
        }
    };

    const saveHours = async () => {
        setSaving(true);
        try {
            const hoursData = Object.entries(hours)
                .filter(([_, h]) => h.enabled)
                .map(([day, h]) => ({
                    dayOfWeek: parseInt(day),
                    startTime: h.start,
                    endTime: h.end,
                    isActive: true,
                }));
            await api.put('/availability/hours', hoursData);
        } catch (err) {
            console.error('Failed to save hours:', err);
        } finally {
            setSaving(false);
        }
    };

    const toggleDay = (day: number) => {
        setHours({ ...hours, [day]: { ...hours[day], enabled: !hours[day].enabled } });
    };

    const updateTime = (day: number, field: 'start' | 'end', value: string) => {
        setHours({ ...hours, [day]: { ...hours[day], [field]: value } });
    };

    const addBlackout = async () => {
        if (!blackoutDate) return;
        setSavingBlackout(true);
        try {
            await api.post('/availability/blackouts', {
                date: blackoutDate,
                reason: blackoutReason || undefined,
            });
            setShowBlackoutModal(false);
            setBlackoutDate('');
            setBlackoutReason('');
            fetchData();
        } catch (err) {
            console.error('Failed to add blackout:', err);
        } finally {
            setSavingBlackout(false);
        }
    };

    const deleteBlackout = async (id: string) => {
        try {
            await api.delete(`/availability/blackouts/${id}`);
            fetchData();
        } catch (err) {
            console.error('Failed to delete blackout:', err);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Availability</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Set working hours for {tenant?.name}
                    </p>
                </div>
                <Button onClick={saveHours} isLoading={saving}>
                    <Save className="w-4 h-4" /> Save Changes
                </Button>
            </div>

            {/* Working Hours */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Clock className="w-5 h-5 text-emerald-500" />
                        Working Hours
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                        {days.map((day, idx) => (
                            <motion.div
                                key={day}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: idx * 0.04 }}
                                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between"
                            >
                                <div className="flex items-center space-x-4">
                                    <button
                                        onClick={() => toggleDay(idx)}
                                        className={cn(
                                            'w-10 h-6 rounded-full transition-colors relative',
                                            hours[idx]?.enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
                                        )}
                                    >
                                        <div className={cn(
                                            'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all',
                                            hours[idx]?.enabled ? 'left-[18px]' : 'left-0.5'
                                        )} />
                                    </button>
                                    <span className={cn(
                                        'font-medium w-28 text-sm',
                                        hours[idx]?.enabled ? 'text-slate-900 dark:text-white' : 'text-slate-400'
                                    )}>
                                        {day}
                                    </span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="time"
                                        value={hours[idx]?.start || '09:00'}
                                        onChange={(e) => updateTime(idx, 'start', e.target.value)}
                                        disabled={!hours[idx]?.enabled}
                                        className="px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                    />
                                    <span className="text-slate-400 text-sm">to</span>
                                    <input
                                        type="time"
                                        value={hours[idx]?.end || '17:00'}
                                        onChange={(e) => updateTime(idx, 'end', e.target.value)}
                                        disabled={!hours[idx]?.enabled}
                                        className="px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                    />
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Blackout Dates */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between w-full">
                        <CardTitle>
                            <CalendarOff className="w-5 h-5 text-red-500" />
                            Blocked Dates
                        </CardTitle>
                        <Button variant="destructive" size="sm" onClick={() => setShowBlackoutModal(true)}>
                            <Plus className="w-4 h-4" /> Add Date
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {blackouts.length === 0 ? (
                        <div className="px-6 py-10 text-center text-slate-500 dark:text-slate-400">
                            No blocked dates. Add dates when you&apos;re unavailable.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                            {blackouts.map((blackout) => (
                                <div key={blackout.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div>
                                        <span className="font-medium text-sm text-slate-900 dark:text-white">
                                            {formatDate(blackout.date)}
                                        </span>
                                        {blackout.reason && (
                                            <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">
                                                — {blackout.reason}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => deleteBlackout(blackout.id)}
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Add Blackout Modal */}
            <Modal isOpen={showBlackoutModal} onClose={() => setShowBlackoutModal(false)} title="Block a Date">
                <div className="space-y-4">
                    <DashboardInput
                        type="date"
                        label="Date"
                        value={blackoutDate}
                        onChange={(e) => setBlackoutDate(e.target.value)}
                    />
                    <DashboardInput
                        type="text"
                        label="Reason (optional)"
                        value={blackoutReason}
                        onChange={(e) => setBlackoutReason(e.target.value)}
                        placeholder="e.g., Holiday, Vacation"
                    />
                    <div className="flex gap-3 pt-2">
                        <Button variant="outline" className="flex-1" onClick={() => setShowBlackoutModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={addBlackout}
                            isLoading={savingBlackout}
                            disabled={!blackoutDate}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                        >
                            Block Date
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
