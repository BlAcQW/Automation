'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';
import {
    Building, User as UserIcon, Lock, Calendar, Save, Loader2, CheckCircle, ExternalLink, CreditCard, BarChart3, Mail, MessageSquareMore,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DashboardInput } from '@/components/ui/input';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

interface PaymentsStatus {
    connected: boolean;
    publicKey: string | null;
    currency: string;
}

interface BillingPlan {
    id: 'free' | 'starter' | 'pro';
    name: string;
    monthlyPrice: number;
    currency: string;
    monthlyMessageQuota: number;
    features: {
        maxServices: number | 'unlimited';
        maxStaff: number | 'unlimited';
        maxTemplates: number | 'unlimited';
        customBranding: boolean;
    };
}

type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;

interface BillingStatus {
    plan: BillingPlan;
    subscription: {
        status: SubscriptionStatus;
        trialEndsAt: string | null;
        currentPeriodEnd: string | null;
    };
    usage: {
        messages: { used: number; limit: number; ok: boolean };
        month: string;
    };
    availablePlans: BillingPlan[];
    paystackConfigured: boolean;
}

export default function SettingsPage() {
    const { tenant, user } = useAuth();
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState('');

    // Business settings
    const [businessName, setBusinessName] = useState('');
    const [timezone, setTimezone] = useState('UTC');

    // Profile settings
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    // Password
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Calendar
    const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; provider: string | null } | null>(null);
    const [connecting, setConnecting] = useState(false);

    // Payments (Paystack)
    const [paymentsStatus, setPaymentsStatus] = useState<PaymentsStatus | null>(null);
    const [paymentsSecret, setPaymentsSecret] = useState('');
    const [paymentsPublic, setPaymentsPublic] = useState('');
    const [paymentsCurrency, setPaymentsCurrency] = useState<SupportedCurrency>('NGN');
    const [paymentsSubmitting, setPaymentsSubmitting] = useState(false);

    const timezones = [
        'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore',
        'Australia/Sydney', 'Pacific/Auckland'
    ];

    useEffect(() => {
        if (tenant) {
            setBusinessName(tenant.name);
            setTimezone(tenant.timezone || 'UTC');
        }
        if (user) {
            setName(user.name);
            setEmail(user.email);
        }
        fetchCalendarStatus();
    }, [tenant, user]);

    useEffect(() => {
        fetchPaymentsStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchPaymentsStatus = async () => {
        try {
            const res = await api.get('/payments/status');
            setPaymentsStatus(res.data);
            if (res.data?.currency) {
                setPaymentsCurrency(res.data.currency as SupportedCurrency);
            }
        } catch {
            // Silent: payments status endpoint may not be ready
        }
    };

    const connectPayments = async (e: React.FormEvent) => {
        e.preventDefault();
        setPaymentsSubmitting(true);
        try {
            await api.post('/payments/connect', {
                publicKey: paymentsPublic.trim(),
                secretKey: paymentsSecret.trim(),
                currency: paymentsCurrency,
            });
            toast.success('Paystack connected');
            setPaymentsSecret('');
            setPaymentsPublic('');
            await fetchPaymentsStatus();
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Connect failed');
        } finally {
            setPaymentsSubmitting(false);
        }
    };

    const disconnectPayments = async () => {
        if (!confirm('Disconnect Paystack? Customers will stop receiving payment links on new orders.')) return;
        try {
            await api.post('/payments/disconnect');
            toast.success('Paystack disconnected');
            await fetchPaymentsStatus();
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Disconnect failed');
        }
    };

    const fetchCalendarStatus = async () => {
        try {
            const response = await api.get('/calendar/status');
            setCalendarStatus(response.data.data);
        } catch (err) {
            console.error('Failed to fetch calendar status:', err);
        }
    };

    const saveBusiness = async () => {
        setSaving(true);
        setSuccess('');
        try {
            await api.put('/tenant', { name: businessName, timezone });
            setSuccess('Business settings saved');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            console.error('Failed to save business settings:', err);
        } finally {
            setSaving(false);
        }
    };

    const saveProfile = async () => {
        setSaving(true);
        setSuccess('');
        try {
            await api.put('/users/me', { name, email });
            setSuccess('Profile saved');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            console.error('Failed to save profile:', err);
        } finally {
            setSaving(false);
        }
    };

    const changePassword = async () => {
        if (newPassword !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        setSaving(true);
        try {
            await api.put('/users/me/password', { currentPassword, newPassword });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccess('Password changed');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            console.error('Failed to change password:', err);
        } finally {
            setSaving(false);
        }
    };

    const connectCalendar = async () => {
        setConnecting(true);
        try {
            const response = await api.get('/calendar/auth-url');
            window.location.href = response.data.data.url;
        } catch (err) {
            console.error('Failed to connect calendar:', err);
            setConnecting(false);
        }
    };

    const disconnectCalendar = async () => {
        try {
            await api.delete('/calendar/disconnect');
            fetchCalendarStatus();
        } catch (err) {
            console.error('Failed to disconnect calendar:', err);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">
                    Manage your business and account preferences
                </p>
            </div>

            {/* Success Banner */}
            {success && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-2 text-sm"
                >
                    <CheckCircle className="w-4 h-4" /> {success}
                </motion.div>
            )}

            {/* Business Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Building className="w-5 h-5 text-emerald-500" />
                        Business Information
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DashboardInput
                        label="Business Name"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                    />
                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Timezone</label>
                        <select
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 transition-all"
                        >
                            {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                        </select>
                    </div>
                    <div className="pt-2">
                        <Button onClick={saveBusiness} isLoading={saving}>
                            <Save className="w-4 h-4" /> Save Changes
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Profile Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <UserIcon className="w-5 h-5 text-blue-500" />
                        Profile
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DashboardInput
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <DashboardInput
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    <div className="pt-2">
                        <Button onClick={saveProfile} isLoading={saving}>
                            <Save className="w-4 h-4" /> Save Profile
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Password */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Lock className="w-5 h-5 text-amber-500" />
                        Change Password
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DashboardInput
                        label="Current Password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <DashboardInput
                            label="New Password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <DashboardInput
                            label="Confirm Password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                    </div>
                    <div className="pt-2">
                        <Button onClick={changePassword} isLoading={saving} disabled={!currentPassword || !newPassword}>
                            Update Password
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Calendar Integration */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Calendar className="w-5 h-5 text-purple-500" />
                        Calendar Integration
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {calendarStatus?.connected ? (
                        <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm">Google Calendar Connected</p>
                                    <p className="text-emerald-700 dark:text-emerald-300 text-xs">Bookings will sync automatically</p>
                                </div>
                            </div>
                            <Button variant="destructive" size="sm" onClick={disconnectCalendar}>
                                Disconnect
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-600">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-slate-500" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900 dark:text-slate-200 text-sm">Google Calendar</p>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs">Sync bookings with your calendar</p>
                                </div>
                            </div>
                            <Button size="sm" onClick={connectCalendar} isLoading={connecting}>
                                <ExternalLink className="w-4 h-4" /> Connect
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Plan & Usage (Phase 4a) */}
            <PlanAndUsageCard />

            {/* Payments (Paystack) */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <CreditCard className="w-5 h-5 text-emerald-500" />
                        Payments (Paystack)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {paymentsStatus?.connected ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                        <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm">Paystack connected</p>
                                        <p className="text-emerald-700 dark:text-emerald-300 text-xs">
                                            Charging in <span className="font-mono">{paymentsStatus.currency}</span>
                                            {paymentsStatus.publicKey && (
                                                <> · public key <span className="font-mono">{paymentsStatus.publicKey.slice(0, 16)}…</span></>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <Button variant="destructive" size="sm" onClick={disconnectPayments}>
                                    Disconnect
                                </Button>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Configure your Paystack webhook to{' '}
                                <code className="text-emerald-700 dark:text-emerald-400">YOUR_API_URL/payments/webhook</code>{' '}
                                so order payments confirm automatically.
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={connectPayments} className="space-y-4">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Paste your Paystack keys from{' '}
                                <a
                                    href="https://dashboard.paystack.com/#/settings/developer"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-600 dark:text-emerald-400 underline"
                                >
                                    Dashboard → Settings → API Keys
                                </a>
                                . The secret key is encrypted at rest.
                            </p>
                            <DashboardInput
                                label="Public Key"
                                placeholder="pk_test_..."
                                value={paymentsPublic}
                                onChange={(e) => setPaymentsPublic(e.target.value)}
                                required
                            />
                            <DashboardInput
                                label="Secret Key"
                                type="password"
                                placeholder="sk_test_..."
                                value={paymentsSecret}
                                onChange={(e) => setPaymentsSecret(e.target.value)}
                                required
                            />
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Currency
                                </label>
                                <select
                                    value={paymentsCurrency}
                                    onChange={(e) => setPaymentsCurrency(e.target.value as SupportedCurrency)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                                >
                                    {SUPPORTED_CURRENCIES.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            <Button type="submit" disabled={paymentsSubmitting || !paymentsPublic || !paymentsSecret}>
                                {paymentsSubmitting ? 'Connecting…' : 'Connect Paystack'}
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>

            {/* SMS Fallback (Arkesel, Phase 5) */}
            <SmsFallbackCard />

            {/* Email Fallback (Gmail SMTP, Phase 5) */}
            <EmailFallbackCard />
        </div>
    );
}

// ============================================================================
// Plan & Usage card
// ============================================================================

function usageBarColor(used: number, limit: number): string {
    if (limit <= 0) return 'bg-slate-300 dark:bg-slate-700';
    const pct = used / limit;
    if (pct >= 1) return 'bg-red-500';
    if (pct >= 0.8) return 'bg-amber-500';
    return 'bg-emerald-500';
}

function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function PlanAndUsageCard() {
    const queryClient = useQueryClient();
    const [pendingPlanId, setPendingPlanId] = useState<'starter' | 'pro' | null>(null);
    const [cancelling, setCancelling] = useState(false);

    const { data, isLoading, error } = useQuery({
        queryKey: ['billing', 'status'],
        queryFn: async () => {
            const res = await api.get('/billing/status');
            return res.data as BillingStatus;
        },
    });

    const subscribe = async (planId: 'starter' | 'pro') => {
        setPendingPlanId(planId);
        try {
            const res = await api.post('/billing/subscribe', { planId });
            if (res.data?.authorizationUrl) {
                window.location.href = res.data.authorizationUrl;
                return;
            }
            toast.error('Could not start checkout');
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Upgrade failed');
        } finally {
            setPendingPlanId(null);
        }
    };

    const cancel = async () => {
        if (!confirm('Cancel subscription? Paid features end at the current period.')) return;
        setCancelling(true);
        try {
            await api.post('/billing/cancel');
            toast.success('Subscription cancelled — paid features run until the period end.');
            await queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Cancel failed');
        } finally {
            setCancelling(false);
        }
    };

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>
                        <BarChart3 className="w-5 h-5 text-emerald-500" />
                        Plan & Usage
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error || !data) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>
                        <BarChart3 className="w-5 h-5 text-emerald-500" />
                        Plan & Usage
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-red-500">Failed to load plan info.</p>
                </CardContent>
            </Card>
        );
    }

    const { plan, usage, subscription } = data;
    const used = usage.messages.used;
    const limit = usage.messages.limit;
    const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
    const overQuota = !usage.messages.ok;
    const trialDays = daysUntil(subscription.trialEndsAt);
    const periodEndDate = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
        : null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <BarChart3 className="w-5 h-5 text-emerald-500" />
                    Plan & Usage
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Current plan</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {plan.name}
                            <span className="ml-2 text-sm font-normal text-slate-500">
                                {plan.monthlyPrice === 0
                                    ? 'Free'
                                    : `${plan.currency} ${plan.monthlyPrice}/mo`}
                            </span>
                        </p>
                    </div>
                    <Badge variant={plan.id === 'pro' ? 'default' : plan.id === 'starter' ? 'blue' : 'slate'}>
                        {plan.id.toUpperCase()}
                    </Badge>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1.5 text-sm">
                        <span className="text-slate-600 dark:text-slate-300">
                            Outbound WhatsApp messages this month
                        </span>
                        <span className="font-mono text-slate-900 dark:text-white">
                            {used.toLocaleString()} / {limit.toLocaleString()}
                        </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                            className={`h-full ${usageBarColor(used, limit)} transition-all`}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Counts every successful outbound send: bot replies, staff replies, and worker
                        notifications (booking confirmations, reminders, etc.). Resets on the 1st of each month (UTC).
                    </p>
                </div>

                {overQuota && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
                        Quota reached. Outbound messages are temporarily paused. Upgrade to keep sending.
                    </div>
                )}

                <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Limits</p>
                    <ul className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <li>Services: {String(plan.features.maxServices)}</li>
                        <li>Staff: {String(plan.features.maxStaff)}</li>
                        <li>Templates: {String(plan.features.maxTemplates)}</li>
                        <li>Custom branding: {plan.features.customBranding ? 'yes' : 'no'}</li>
                    </ul>
                </div>

                {/* Subscription state banners */}
                {subscription.status === 'TRIALING' && (
                    <div className="rounded-xl border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
                        {trialDays != null && trialDays > 0
                            ? `${trialDays} day${trialDays === 1 ? '' : 's'} left in your free trial.`
                            : 'Your trial has ended.'}{' '}
                        Subscribe to keep Pro features.
                    </div>
                )}
                {subscription.status === 'PAST_DUE' && (
                    <div className="rounded-xl border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-200">
                        Your last payment failed. Update your payment method to avoid downgrade.
                    </div>
                )}
                {subscription.status === 'CANCELLED' && periodEndDate && new Date(subscription.currentPeriodEnd ?? 0).getTime() > Date.now() && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50 p-3 text-sm text-slate-700 dark:text-slate-300">
                        Subscription cancelled. Paid features end on {periodEndDate}.
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                        {data.paystackConfigured
                            ? 'Plan changes complete on Paystack — your card is charged immediately.'
                            : 'Self-serve billing is not configured. Email support to change your plan.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {data.paystackConfigured ? (
                            <>
                                {plan.id !== 'starter' && subscription.status !== 'ACTIVE' && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => subscribe('starter')}
                                        disabled={pendingPlanId !== null}
                                    >
                                        {pendingPlanId === 'starter' ? 'Redirecting…' : 'Upgrade to Starter'}
                                    </Button>
                                )}
                                {plan.id !== 'pro' && subscription.status !== 'ACTIVE' && (
                                    <Button
                                        size="sm"
                                        onClick={() => subscribe('pro')}
                                        disabled={pendingPlanId !== null}
                                    >
                                        {pendingPlanId === 'pro' ? 'Redirecting…' : 'Upgrade to Pro'}
                                    </Button>
                                )}
                                {subscription.status === 'PAST_DUE' && (
                                    <Button
                                        size="sm"
                                        onClick={() => subscribe(plan.id === 'pro' ? 'pro' : 'starter')}
                                        disabled={pendingPlanId !== null}
                                    >
                                        Retry payment
                                    </Button>
                                )}
                                {subscription.status === 'ACTIVE' && (
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={cancel}
                                        disabled={cancelling}
                                    >
                                        {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                                    </Button>
                                )}
                            </>
                        ) : (
                            <a
                                href="mailto:support@bookingflow.app?subject=Plan%20upgrade"
                                className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400 hover:underline"
                            >
                                <Mail className="w-4 h-4" /> Contact support
                            </a>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

// ============================================================================
// SMS Fallback card (Phase 5 — Arkesel)
// ============================================================================

interface SmsStatus {
    connected: boolean;
    senderId: string | null;
    balance: number | null;
}

function SmsFallbackCard() {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['sms', 'status'],
        queryFn: async () => (await api.get('/sms/status')).data as SmsStatus,
    });
    const [apiKey, setApiKey] = useState('');
    const [senderId, setSenderId] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/sms/connect', { apiKey: apiKey.trim(), senderId: senderId.trim() });
            toast.success('SMS fallback connected');
            setApiKey('');
            setSenderId('');
            await queryClient.invalidateQueries({ queryKey: ['sms', 'status'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Connect failed');
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        if (!confirm('Disconnect SMS fallback? Failed WhatsApp sends will no longer fall back to SMS.')) return;
        try {
            await api.post('/sms/disconnect');
            toast.success('SMS fallback disconnected');
            await queryClient.invalidateQueries({ queryKey: ['sms', 'status'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Disconnect failed');
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <MessageSquareMore className="w-5 h-5 text-emerald-500" />
                    SMS Fallback (Arkesel)
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                ) : data?.connected ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm">SMS fallback connected</p>
                                    <p className="text-emerald-700 dark:text-emerald-300 text-xs">
                                        Sender <span className="font-mono">{data.senderId}</span>
                                        {data.balance != null && (
                                            <> · balance <span className="font-mono">{data.balance}</span></>
                                        )}
                                    </p>
                                </div>
                            </div>
                            <Button variant="destructive" size="sm" onClick={disconnect}>
                                Disconnect
                            </Button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            When a WhatsApp template send fails, BookingFlow falls back to SMS via Arkesel.
                            One SMS counts as one outbound message toward your monthly quota.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={connect} className="space-y-4">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Paste your Arkesel API key from{' '}
                            <a
                                href="https://account.arkesel.com"
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-600 dark:text-emerald-400 underline"
                            >
                                account.arkesel.com → Developer
                            </a>
                            . The key is encrypted at rest.
                        </p>
                        <DashboardInput
                            label="API Key"
                            type="password"
                            placeholder="ArkeselApiKey..."
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            required
                        />
                        <DashboardInput
                            label="Sender ID (1-11 chars)"
                            placeholder="BookingFlow"
                            value={senderId}
                            onChange={(e) => setSenderId(e.target.value)}
                            required
                            maxLength={11}
                        />
                        <Button type="submit" disabled={submitting || !apiKey || !senderId}>
                            {submitting ? 'Connecting…' : 'Connect Arkesel'}
                        </Button>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}

// ============================================================================
// Email Fallback card (Phase 5 — Gmail SMTP)
// ============================================================================

interface EmailStatus {
    connected: boolean;
    user: string | null;
    fromName: string | null;
}

function EmailFallbackCard() {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['email', 'status'],
        queryFn: async () => (await api.get('/email/status')).data as EmailStatus,
    });
    const [user, setUser] = useState('');
    const [appPassword, setAppPassword] = useState('');
    const [fromName, setFromName] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/email/connect', {
                user: user.trim(),
                appPassword: appPassword.trim(),
                fromName: fromName.trim() || undefined,
            });
            toast.success('Email fallback connected');
            setUser('');
            setAppPassword('');
            setFromName('');
            await queryClient.invalidateQueries({ queryKey: ['email', 'status'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Connect failed');
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        if (!confirm('Disconnect email fallback? Failed WhatsApp + SMS sends will no longer fall back to email.')) return;
        try {
            await api.post('/email/disconnect');
            toast.success('Email fallback disconnected');
            await queryClient.invalidateQueries({ queryKey: ['email', 'status'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Disconnect failed');
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Mail className="w-5 h-5 text-emerald-500" />
                    Email Fallback (Gmail SMTP)
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                ) : data?.connected ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm">Email fallback connected</p>
                                    <p className="text-emerald-700 dark:text-emerald-300 text-xs">
                                        <span className="font-mono">{data.user}</span>
                                        {data.fromName && <> · from “{data.fromName}”</>}
                                    </p>
                                </div>
                            </div>
                            <Button variant="destructive" size="sm" onClick={disconnect}>
                                Disconnect
                            </Button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Email fallback fires only when the booking or order has a customer email
                            attached. Bot-side email collection arrives in a future release; for now
                            staff can enter customer emails manually via the dashboard.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={connect} className="space-y-4">
                        <div className="rounded-xl border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
                            Platform fallback is enabled by default — emails go out from
                            BookingFlow&apos;s shared sender when WhatsApp + SMS fail. Connect your
                            own Gmail below to send from your own brand instead.
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Generate a 16-character app password at{' '}
                            <a
                                href="https://myaccount.google.com/apppasswords"
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-600 dark:text-emerald-400 underline"
                            >
                                myaccount.google.com/apppasswords
                            </a>
                            . Your regular Gmail password will not work.
                        </p>
                        <DashboardInput
                            label="Gmail address"
                            type="email"
                            placeholder="you@gmail.com"
                            value={user}
                            onChange={(e) => setUser(e.target.value)}
                            required
                        />
                        <DashboardInput
                            label="App Password (16 chars)"
                            type="password"
                            placeholder="xxxx xxxx xxxx xxxx"
                            value={appPassword}
                            onChange={(e) => setAppPassword(e.target.value)}
                            required
                        />
                        <DashboardInput
                            label="From name (optional)"
                            placeholder="BookingFlow"
                            value={fromName}
                            onChange={(e) => setFromName(e.target.value)}
                        />
                        <Button type="submit" disabled={submitting || !user || !appPassword}>
                            {submitting ? 'Verifying…' : 'Connect Gmail SMTP'}
                        </Button>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
