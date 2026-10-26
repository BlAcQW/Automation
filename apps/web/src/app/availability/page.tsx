'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Clock, Plus, Trash2, CalendarOff, Users, Minus } from 'lucide-react';
import {
    Card,
    Button,
    Modal,
    DashboardInput,
    ConfirmDialog,
    EmptyState,
    ErrorState,
    PageHeader,
    SectionHeading,
    Skeleton,
    SkeletonLine,
    Switch,
    TickPop,
    controlClasses,
    cn,
} from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';

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
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);
    // Bumped on every successful save so the TickPop re-mounts and replays.
    const [savedKey, setSavedKey] = useState(0);
    const [hours, setHours] = useState<{ [key: number]: { enabled: boolean; start: string; end: string } }>({});
    const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
    const [showBlackoutModal, setShowBlackoutModal] = useState(false);
    const [blackoutDate, setBlackoutDate] = useState('');
    const [blackoutReason, setBlackoutReason] = useState('');
    const [savingBlackout, setSavingBlackout] = useState(false);
    const [removing, setRemoving] = useState<BlackoutDate | null>(null);
    const [removingBusy, setRemovingBusy] = useState(false);
    // How many bookings can run at the same time — chairs, rooms, bays. The
    // engine offered one booking per slot before this existed, so a multi-chair
    // salon was showing only a fraction of its real availability.
    const [capacity, setCapacity] = useState(1);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [hoursRes, blackoutsRes, meRes] = await Promise.all([
                api.get('/availability/hours'),
                api.get('/availability/blackouts'),
                api.get('/auth/me'),
            ]);
            setCapacity(meRes.data?.tenant?.bookingCapacity ?? 1);

            const hoursMap: { [key: number]: { enabled: boolean; start: string; end: string } } = {};
            for (let i = 0; i < 7; i++) {
                hoursMap[i] = { enabled: false, start: '09:00', end: '17:00' };
            }

            hoursRes.data.data.forEach((h: WorkingHours) => {
                hoursMap[h.dayOfWeek] = { enabled: h.isActive, start: h.startTime, end: h.endTime };
            });

            setHours(hoursMap);
            setBlackouts(blackoutsRes.data.data);
            setLoadError(false);
        } catch (err) {
            console.error('Failed to fetch availability:', err);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    const retryLoad = () => {
        setLoading(true);
        fetchData();
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
            await api.patch('/auth/profile', { bookingCapacity: capacity });
            setSavedKey((k) => k + 1);
            notify.success('Opening hours saved');
        } catch (err) {
            console.error('Failed to save hours:', err);
            notify.error("Oops, your hours didn't save. Let's try again.");
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
            notify.success('Day off added');
            fetchData();
        } catch (err) {
            console.error('Failed to add blackout:', err);
            notify.error("Oops, we couldn't add that day. Let's try again.");
        } finally {
            setSavingBlackout(false);
        }
    };

    const deleteBlackout = async (id: string) => {
        setRemovingBusy(true);
        try {
            await api.delete(`/availability/blackouts/${id}`);
            notify.success('Day off removed');
            setRemoving(null);
            fetchData();
        } catch (err) {
            console.error('Failed to delete blackout:', err);
            notify.error("Oops, we couldn't remove that day. Let's try again.");
        } finally {
            setRemovingBusy(false);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };

    const header = (
        <PageHeader
            title="Opening hours"
            subtitle={
                tenant?.name
                    ? `When customers can book ${tenant.name}. Bookly only offers times inside these hours.`
                    : 'When customers can book you. Bookly only offers times inside these hours.'
            }
            actions={
                !loading && !loadError ? (
                    <div className="flex items-center gap-3">
                        {savedKey > 0 && !saving && <TickPop key={savedKey} size={36} label="Opening hours saved" />}
                        <Button onClick={saveHours} isLoading={saving} loadingText="Saving…">
                            Save hours
                        </Button>
                    </div>
                ) : undefined
            }
        />
    );

    if (loading) {
        return (
            <div className="space-y-6">
                {header}
                <div aria-busy="true" className="space-y-6">
                    <span className="sr-only">Loading your opening hours…</span>
                    <Card className="p-5">
                        <SkeletonLine width="w-1/3" />
                        <Skeleton className="mt-4 h-11 w-40 rounded-control" />
                    </Card>
                    <Card className="divide-y divide-border">
                        {days.map((d) => (
                            <div key={d} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-4">
                                    <Skeleton className="h-7 w-12 rounded-full" />
                                    <SkeletonLine width="w-24" />
                                </div>
                                <div className="flex gap-3">
                                    <Skeleton className="h-12 w-32 rounded-control" />
                                    <Skeleton className="h-12 w-32 rounded-control" />
                                </div>
                            </div>
                        ))}
                    </Card>
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="space-y-6">
                {header}
                <Card>
                    <ErrorState
                        description="We couldn't load your opening hours. Nothing has changed. Check your connection, then try again."
                        onRetry={retryLoad}
                    />
                </Card>
            </div>
        );
    }

    const openDays = days.filter((_, i) => hours[i]?.enabled).length;

    return (
        <div className="space-y-6">
            {header}

            {/* Weekly hours */}
            <Card>
                <div className="border-b border-border px-5 py-4 sm:px-6">
                    <SectionHeading
                        title="Your week"
                        description={
                            openDays === 0
                                ? "You're closed every day, so customers can't book yet. Switch on the days you work."
                                : `Open ${openDays} ${openDays === 1 ? 'day' : 'days'} a week.`
                        }
                    />
                </div>
                <ul className="divide-y divide-border">
                    {days.map((day, idx) => {
                        const on = !!hours[idx]?.enabled;
                        return (
                            <li
                                key={day}
                                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                            >
                                <div className="flex min-h-[44px] items-center gap-4">
                                    <Switch
                                        checked={on}
                                        onChange={() => toggleDay(idx)}
                                        label={`Open on ${day}`}
                                    />
                                    <div>
                                        <span className={cn('block w-28 font-semibold', on ? 'text-text' : 'text-muted')}>
                                            {day}
                                        </span>
                                        <span className="text-small text-muted">{on ? 'Open' : 'Closed'}</span>
                                    </div>
                                </div>
                                {on ? (
                                    <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
                                        <div className="space-y-1">
                                            <label htmlFor={`open-${idx}`} className="block text-small text-muted">
                                                Opens
                                            </label>
                                            <input
                                                id={`open-${idx}`}
                                                type="time"
                                                value={hours[idx]?.start || '09:00'}
                                                onChange={(e) => updateTime(idx, 'start', e.target.value)}
                                                className={cn(controlClasses, 'tabular-nums sm:w-36')}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label htmlFor={`close-${idx}`} className="block text-small text-muted">
                                                Closes
                                            </label>
                                            <input
                                                id={`close-${idx}`}
                                                type="time"
                                                value={hours[idx]?.end || '17:00'}
                                                onChange={(e) => updateTime(idx, 'end', e.target.value)}
                                                className={cn(controlClasses, 'tabular-nums sm:w-36')}
                                            />
                                        </div>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </Card>

            {/* Concurrent capacity */}
            <Card className="p-5 sm:p-6">
                <SectionHeading
                    title="Customers at the same time"
                    description="Chairs in a salon, rooms in a clinic, bays in a workshop."
                />
                <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3" role="group" aria-label="Customers at the same time">
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            aria-label="Fewer at a time"
                            onClick={() => setCapacity(Math.max(1, capacity - 1))}
                            disabled={capacity <= 1}
                        >
                            <Minus className="h-5 w-5" aria-hidden />
                        </Button>
                        <span className="w-12 text-center text-[28px] font-bold tabular-nums text-text" aria-live="polite">
                            {capacity}
                        </span>
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            aria-label="More at a time"
                            onClick={() => setCapacity(Math.min(100, capacity + 1))}
                            disabled={capacity >= 100}
                        >
                            <Plus className="h-5 w-5" aria-hidden />
                        </Button>
                    </div>
                    <p className="flex items-start gap-2 text-[15px] text-muted sm:max-w-md">
                        <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {capacity === 1
                            ? 'One booking per time slot.'
                            : `Up to ${capacity} bookings can share the same time slot.`}
                    </p>
                </div>
            </Card>

            {/* Days off */}
            <Card>
                <div className="border-b border-border px-5 py-4 sm:px-6">
                    <SectionHeading
                        title="Days off"
                        description="Holidays and days you're away. Nobody can book these."
                        actions={
                            blackouts.length > 0 ? (
                                <Button variant="secondary" size="sm" onClick={() => setShowBlackoutModal(true)}>
                                    <Plus className="h-4 w-4" aria-hidden /> Add a day off
                                </Button>
                            ) : undefined
                        }
                    />
                </div>
                {blackouts.length === 0 ? (
                    <EmptyState
                        icon={<CalendarOff />}
                        title="No days off yet"
                        description="Going on holiday or closing for a public holiday? Add the date so nobody books it."
                        action={
                            <Button variant="secondary" onClick={() => setShowBlackoutModal(true)}>
                                <Plus className="h-5 w-5" aria-hidden /> Add a day off
                            </Button>
                        }
                    />
                ) : (
                    <ul className="divide-y divide-border">
                        {blackouts.map((blackout) => (
                            <li
                                key={blackout.id}
                                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-2 sm:px-6"
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-muted" aria-hidden>
                                        <Clock className="h-5 w-5" />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-text">{formatDate(blackout.date)}</p>
                                        {blackout.reason && <p className="truncate text-small text-muted">{blackout.reason}</p>}
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setRemoving(blackout)}
                                    aria-label={`Remove day off on ${formatDate(blackout.date)}`}
                                    className="text-error-fg hover:bg-error-soft"
                                >
                                    <Trash2 className="h-5 w-5" aria-hidden />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {/* Add a day off */}
            <Modal
                isOpen={showBlackoutModal}
                onClose={() => setShowBlackoutModal(false)}
                title="Add a day off"
                description="Customers won't be offered any times on this day."
            >
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
                        placeholder="e.g. Independence Day, family event"
                    />
                    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                        <Button variant="ghost" onClick={() => setShowBlackoutModal(false)}>
                            Cancel
                        </Button>
                        <Button onClick={addBlackout} isLoading={savingBlackout} disabled={!blackoutDate}>
                            Add day off
                        </Button>
                    </div>
                </div>
            </Modal>

            <ConfirmDialog
                isOpen={!!removing}
                onClose={() => setRemoving(null)}
                onConfirm={() => removing && deleteBlackout(removing.id)}
                title="Remove this day off?"
                description={
                    removing
                        ? `Customers will be able to book on ${formatDate(removing.date)} again.`
                        : undefined
                }
                confirmLabel="Remove"
                isLoading={removingBusy}
            />
        </div>
    );
}
