'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export type SetupStepKey = 'whatsapp' | 'catalogue' | 'hours';

export interface SetupStep {
    key: SetupStepKey;
    title: string;
    detail: string;
    /** The existing page where this step gets done. */
    href: string;
    cta: string;
    done: boolean;
}

export interface SetupStatus {
    steps: SetupStep[];
    doneCount: number;
    /** First step not yet done, or null when everything is set up. */
    current: SetupStep | null;
    isLoading: boolean;
    isError: boolean;
    retry: () => void;
}

function asList(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    const data = (body as { data?: unknown } | null)?.data;
    return Array.isArray(data) ? data : [];
}

/**
 * Setup progress, derived from data that already exists (WhatsApp status,
 * catalogue size, opening hours). Nothing is stored, so it can never go
 * stale. Query keys match the rest of the app, so visiting a step's page and
 * coming back shares the cache.
 *
 * Product businesses have no opening hours (the hours query stays off for
 * them, as before), so they get two steps instead of three.
 */
export function useSetupStatus(): SetupStatus {
    const { tenant } = useAuth();
    const isProduct = tenant?.businessType === 'PRODUCT';

    const wa = useQuery<{ connected?: boolean }>({
        queryKey: ['whatsapp', 'status'],
        queryFn: async () => (await api.get('/whatsapp/status')).data,
        staleTime: 30_000,
    });

    const catalogue = useQuery<unknown[]>({
        queryKey: [isProduct ? 'products' : 'services', 'count'],
        queryFn: async () => asList((await api.get(isProduct ? '/products' : '/services')).data),
        staleTime: 30_000,
    });

    const hours = useQuery<{ isOpen?: boolean; isActive?: boolean }[]>({
        queryKey: ['availability', 'hours'],
        queryFn: async () => asList((await api.get('/availability/hours')).data) as { isOpen?: boolean; isActive?: boolean }[],
        enabled: !isProduct,
        staleTime: 30_000,
    });

    const steps: SetupStep[] = [
        {
            key: 'whatsapp',
            title: 'Connect your WhatsApp',
            detail: 'Use the number your customers already know. It takes about two minutes.',
            href: '/whatsapp',
            cta: 'Connect WhatsApp',
            done: !!wa.data?.connected,
        },
        {
            key: 'catalogue',
            title: isProduct ? 'Add your products' : 'Add your services',
            detail: isProduct
                ? 'What you sell and how much it costs. Bookly quotes prices from this list.'
                : 'What you offer, how long it takes and what it costs. Bookly books from this list.',
            href: isProduct ? '/products' : '/services',
            cta: isProduct ? 'Add products' : 'Add services',
            done: (catalogue.data?.length ?? 0) > 0,
        },
        ...(!isProduct
            ? [
                  {
                      key: 'hours' as const,
                      title: 'Set your opening hours',
                      detail: 'So customers are only offered times when you are open.',
                      href: '/availability',
                      cta: 'Set hours',
                      done: (hours.data ?? []).some((h) => h.isOpen ?? h.isActive ?? false),
                  },
              ]
            : []),
    ];

    const queries = isProduct ? [wa, catalogue] : [wa, catalogue, hours];
    const doneCount = steps.filter((s) => s.done).length;

    return {
        steps,
        doneCount,
        current: steps.find((s) => !s.done) ?? null,
        isLoading: queries.some((q) => q.data === undefined && !q.isError),
        isError: queries.some((q) => q.isError),
        retry: () => queries.forEach((q) => q.isError && q.refetch()),
    };
}
