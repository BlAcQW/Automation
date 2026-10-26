'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn } from '@bookingflow/ui';

interface BillingStatus {
    plan: {
        id: string;
        name: string;
        messageLimitPerMonth: number;
    };
    subscription: {
        status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
        trialEndsAt: string | null;
    };
    usage: {
        messages: { used: number; limit: number; ok: boolean };
    };
}

/**
 * Compact plan + monthly message-usage card. Lives at the foot of the
 * dashboard sidebar (above Sign Out) so the operator always knows where they
 * sit against their quota. Quietly hides when the API is unreachable.
 */
export function PlanCard() {
    const { data } = useQuery<BillingStatus>({
        queryKey: ['billing-status'],
        queryFn: async () => (await api.get('/billing/status')).data,
        staleTime: 5 * 60 * 1000,
        retry: 0,
    });

    if (!data) return null;

    const used = data.usage.messages.used;
    const limit = data.usage.messages.limit || 1;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const trialing = data.subscription.status === 'TRIALING';

    return (
        // Quiet surface card at the foot of the sidebar.
        <Link
            href="/settings"
            className="group block rounded-control border border-border bg-surface-2 p-3 text-text transition-colors hover:border-text/20"
        >
            <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-muted">Your plan</p>
                {trialing && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[12px] font-semibold text-accent-fg">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        Trial
                    </span>
                )}
            </div>
            <p className="mt-1 text-[15px] font-semibold text-text">{data.plan.name}</p>

            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                    className={cn(
                        'h-full rounded-full transition-all',
                        pct >= 90 ? 'bg-error' : 'bg-primary',
                    )}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <p className="mt-1.5 text-[13px] tabular-nums text-muted">
                {used.toLocaleString()}/{limit.toLocaleString()} messages used
            </p>
        </Link>
    );
}
