'use client';

/** Settings → Plan & billing: current plan, monthly message usage, promo code, upgrade / cancel. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Mail, AlertTriangle, Clock, Info } from 'lucide-react';
import {
    Button, Badge, DashboardInput, ConfirmDialog, ErrorState, Skeleton, SkeletonLine, StatusPill, formatCedi, cn,
} from '@bookingflow/ui';
import { api } from '@/lib/api';
import { supportMailto, supportWhatsAppUrl } from '@/lib/site';
import { notify } from '@/components/brand/toast';
import { SettingsCard } from './settings-card';

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

const SUBSCRIPTION_PILL: Record<Exclude<SubscriptionStatus, null>, { status: string; label: string }> = {
    TRIALING: { status: 'pending', label: 'Free trial' },
    ACTIVE: { status: 'active', label: 'Active' },
    PAST_DUE: { status: 'failed', label: 'Payment failed' },
    CANCELLED: { status: 'cancelled', label: 'Cancelled' },
};

function usageBarColor(used: number, limit: number): string {
    if (limit <= 0) return 'bg-text/20';
    const pct = used / limit;
    if (pct >= 1) return 'bg-error';
    if (pct >= 0.8) return 'bg-warning';
    return 'bg-success';
}

function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Plan prices are whole currency units. GH₵ goes through formatCedi; others keep the code. */
function planPrice(plan: BillingPlan): string {
    if (plan.monthlyPrice === 0) return 'Free';
    const amount = plan.currency === 'GHS' ? formatCedi(plan.monthlyPrice) : `${plan.currency} ${plan.monthlyPrice}`;
    return `${amount} a month`;
}

function limitText(v: number | 'unlimited'): string {
    return v === 'unlimited' ? 'Unlimited' : String(v);
}

function Notice({ tone, icon, children }: { tone: 'warning' | 'error' | 'info'; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div
            role="status"
            className={cn(
                'flex items-start gap-2.5 rounded-control p-3.5 text-[15px] leading-relaxed [&_svg]:mt-0.5 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                tone === 'warning' && 'bg-warning-soft text-warning-fg',
                tone === 'error' && 'bg-error-soft text-error-fg',
                tone === 'info' && 'bg-surface-2 text-text',
            )}
        >
            {icon}
            <p>{children}</p>
        </div>
    );
}

const CARD = {
    icon: <BarChart3 />,
    title: 'Plan & billing',
    description: 'Your plan, what you have used this month, and upgrades.',
};

export function PlanAndUsageCard() {
    const queryClient = useQueryClient();
    const [pendingPlanId, setPendingPlanId] = useState<'starter' | 'pro' | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);

    const { data, isLoading, error, refetch, isRefetching } = useQuery({
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
            notify.error("Couldn't open checkout. Let's try again.");
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't start your upgrade. Let's try again.");
        } finally {
            setPendingPlanId(null);
        }
    };

    const [promoCode, setPromoCode] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const redeem = async () => {
        if (!promoCode.trim()) return;
        setRedeeming(true);
        try {
            const res = await api.post('/billing/redeem', { code: promoCode.trim() });
            const until = res.data?.endsAt ? new Date(res.data.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
            notify.success(until ? `${res.data.planName} until ${until}` : 'Code applied');
            setPromoCode('');
            await queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "That code didn't work. Check it and try again.");
        } finally {
            setRedeeming(false);
        }
    };

    const cancel = async () => {
        setCancelling(true);
        try {
            await api.post('/billing/cancel');
            notify.success('Subscription cancelled. Paid features run until the period ends.');
            setConfirmCancel(false);
            await queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't cancel. Let's try again.");
        } finally {
            setCancelling(false);
        }
    };

    if (isLoading) {
        return (
            <SettingsCard {...CARD}>
                <div aria-busy="true" className="space-y-4">
                    <span className="sr-only">Loading…</span>
                    <Skeleton className="h-10 w-48" />
                    <SkeletonLine />
                    <Skeleton className="h-2 w-full" />
                    <SkeletonLine className="w-2/3" />
                </div>
            </SettingsCard>
        );
    }

    if (error || !data) {
        return (
            <SettingsCard {...CARD}>
                <ErrorState
                    title="We couldn't load your plan"
                    description="Check your connection, then try again."
                    onRetry={() => refetch()}
                    isRetrying={isRefetching}
                />
            </SettingsCard>
        );
    }

    const { plan, usage, subscription } = data;
    const used = usage.messages.used;
    const limit = usage.messages.limit;
    const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
    const overQuota = !usage.messages.ok;
    const trialDays = daysUntil(subscription.trialEndsAt);
    const periodEndDate = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;
    const pill = subscription.status ? SUBSCRIPTION_PILL[subscription.status] : null;

    return (
        <SettingsCard {...CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-control bg-surface-2 p-4">
                <div>
                    <p className="text-small font-medium text-muted">Your plan</p>
                    <p className="mt-1 text-[28px] font-bold leading-none text-text">{plan.name}</p>
                    <p className="mt-1.5 text-[15px] font-semibold tabular-nums text-text">{planPrice(plan)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {pill && <StatusPill status={pill.status} label={pill.label} />}
                    <Badge variant={plan.id === 'pro' ? 'success' : plan.id === 'starter' ? 'info' : 'neutral'}>
                        {plan.name}
                    </Badge>
                </div>
            </div>

            <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[15px] font-medium text-text">WhatsApp messages sent this month</span>
                    <span className="font-semibold tabular-nums text-text">
                        {used.toLocaleString()} <span className="font-normal text-muted">of {limit.toLocaleString()}</span>
                    </span>
                </div>
                <div
                    className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
                    role="progressbar"
                    aria-label="Messages used this month"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                >
                    <div className={`h-full rounded-full ${usageBarColor(used, limit)} transition-[width] duration-ui-slow`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">
                    Every message Bookly sends counts: automatic replies, your team&apos;s replies, and updates like
                    booking confirmations and reminders. It resets on the 1st of each month.
                </p>
            </div>

            {overQuota && (
                <Notice tone="warning" icon={<AlertTriangle />}>
                    You&apos;ve used all your messages for this month, so sending is paused. Upgrade to keep sending.
                </Notice>
            )}

            <div>
                <p className="mb-2 text-small font-medium text-muted">What your plan includes</p>
                <dl className="grid grid-cols-2 gap-2 text-[15px]">
                    {[
                        ['Services', limitText(plan.features.maxServices)],
                        ['Team members', limitText(plan.features.maxStaff)],
                        ['Message templates', limitText(plan.features.maxTemplates)],
                        ['Your own branding', plan.features.customBranding ? 'Yes' : 'No'],
                    ].map(([k, v]) => (
                        <div key={k} className="rounded-control border border-border px-3 py-2.5">
                            <dt className="text-[13px] text-muted">{k}</dt>
                            <dd className="font-semibold text-text">{v}</dd>
                        </div>
                    ))}
                </dl>
            </div>

            {subscription.status === 'TRIALING' && (
                <Notice tone="info" icon={<Clock />}>
                    {trialDays != null && trialDays > 0
                        ? `${trialDays} day${trialDays === 1 ? '' : 's'} left in your free trial.`
                        : 'Your free trial has ended.'}{' '}
                    Subscribe to keep Pro features.
                </Notice>
            )}
            {subscription.status === 'PAST_DUE' && (
                <Notice tone="error" icon={<AlertTriangle />}>
                    Your last payment didn&apos;t go through. Retry the payment so you keep your plan.
                </Notice>
            )}
            {subscription.status === 'CANCELLED' && periodEndDate && new Date(subscription.currentPeriodEnd ?? 0).getTime() > Date.now() && (
                <Notice tone="info" icon={<Info />}>
                    Subscription cancelled. Paid features end on {periodEndDate}.
                </Notice>
            )}

            <form
                onSubmit={(e) => { e.preventDefault(); redeem(); }}
                className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end"
            >
                <div className="w-full sm:max-w-xs">
                    <DashboardInput
                        label="Have a promo code?"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                        placeholder="LAUNCH-XXXXXXXX"
                        autoCapitalize="characters"
                    />
                </div>
                <Button type="submit" variant="secondary" isLoading={redeeming} disabled={!promoCode.trim()}>
                    Apply code
                </Button>
            </form>

            <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-sm text-[14px] text-muted">
                    {data.paystackConfigured
                        ? 'You pay securely on Paystack. Your card is charged straight away.'
                        : 'To change your plan, message our support team.'}
                </p>
                <div className="flex flex-wrap gap-2">
                    {data.paystackConfigured ? (
                        <>
                            {plan.id !== 'starter' && subscription.status !== 'ACTIVE' && (
                                <Button
                                    variant="secondary"
                                    onClick={() => subscribe('starter')}
                                    disabled={pendingPlanId !== null}
                                    isLoading={pendingPlanId === 'starter'}
                                    loadingText="Opening checkout…"
                                >
                                    Upgrade to Starter
                                </Button>
                            )}
                            {plan.id !== 'pro' && subscription.status !== 'ACTIVE' && (
                                <Button
                                    variant="accent"
                                    onClick={() => subscribe('pro')}
                                    disabled={pendingPlanId !== null}
                                    isLoading={pendingPlanId === 'pro'}
                                    loadingText="Opening checkout…"
                                >
                                    Upgrade to Pro
                                </Button>
                            )}
                            {subscription.status === 'PAST_DUE' && (
                                <Button onClick={() => subscribe(plan.id === 'pro' ? 'pro' : 'starter')} disabled={pendingPlanId !== null}>
                                    Retry payment
                                </Button>
                            )}
                            {subscription.status === 'ACTIVE' && (
                                <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={cancelling}>
                                    Cancel subscription
                                </Button>
                            )}
                        </>
                    ) : (
                        <a
                            href={supportMailto('Plan upgrade') ?? supportWhatsAppUrl('I want to upgrade my plan') ?? '/support'}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-control px-2 text-[15px] font-semibold text-primary hover:underline"
                        >
                            <Mail className="h-4 w-4" aria-hidden /> Contact support
                        </a>
                    )}
                </div>
            </div>

            <ConfirmDialog
                isOpen={confirmCancel}
                onClose={() => setConfirmCancel(false)}
                onConfirm={cancel}
                isLoading={cancelling}
                title="Cancel your subscription?"
                description={`You keep paid features until the end of this billing period${periodEndDate ? ` (${periodEndDate})` : ''}, then move to the free plan.`}
                confirmLabel="Cancel subscription"
                cancelLabel="Keep my plan"
            />
        </SettingsCard>
    );
}
