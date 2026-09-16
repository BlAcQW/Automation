'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The tenant's charging currency, for labels like "Price (GHS)".
 *
 * Comes from the payments status endpoint because that is where the tenant
 * picked it. Defaults to GHS (most of our customers) until it loads, and
 * stays put on failure: a label is not worth an error state.
 */
export function useTenantCurrency(): string {
    const { data } = useQuery({
        queryKey: ['payments', 'status'],
        queryFn: async () => (await api.get('/payments/status')).data as { currency?: string } | undefined,
        staleTime: 5 * 60_000,
        retry: false,
    });
    return data?.currency || 'GHS';
}

/** `GHS 1,250.00` style formatting for money shown in the dashboard. */
export function formatMoney(amount: number | string, currency: string): string {
    const n = Number(amount) || 0;
    return `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
