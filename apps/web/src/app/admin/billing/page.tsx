'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Search, Receipt } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, Badge, Input } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { formatMinor } from './money';

interface TenantRow {
    id: string;
    name: string;
    vertical: string;
    planId: string;
    isActive: boolean;
    terms: {
        currency: string;
        setupFeeMinor: number;
        monthlyFeeMinor: number;
        unitPriceMinor: number;
        unitEventType: string | null;
    } | null;
}

export default function AdminBillingPage() {
    const [search, setSearch] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'billing', 'tenants', search],
        queryFn: async () => {
            const params = new URLSearchParams({ limit: '100' });
            if (search.trim()) params.set('search', search.trim());
            return (await adminApi.get(`/admin/billing/tenants?${params}`)).data as { data: TenantRow[] };
        },
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Billing</h1>
                <p className="text-slate-400">
                    Custom terms and usage statements per organisation. Open an organisation to set its fees or see a month&apos;s statement.
                </p>
            </div>

            <div className="max-w-sm">
                <Input
                    icon={<Search className="w-4 h-4" />}
                    placeholder="Search organisations"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search organisations"
                />
            </div>

            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48"><BooklyDots size="md" /></div>
                ) : !data?.data.length ? (
                    <div className="p-10 text-center text-slate-400">No organisations found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                    <th className="px-6 py-4 font-medium">Organisation</th>
                                    <th className="px-6 py-4 font-medium">Plan</th>
                                    <th className="px-6 py-4 font-medium">Custom terms</th>
                                    <th className="px-6 py-4 font-medium w-1"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.data.map((t) => (
                                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                        <td className="px-6 py-4">
                                            <div className="text-white font-medium">{t.name}</div>
                                            <div className="text-xs text-slate-500">{t.vertical === 'RIDES' ? 'Rides' : 'Appointments'}{t.isActive ? '' : ' · inactive'}</div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-300 capitalize">{t.planId}</td>
                                        <td className="px-6 py-4 text-sm text-slate-300">
                                            {t.terms ? (
                                                <span className="tabular-nums">
                                                    {t.terms.currency} {formatMinor(t.terms.monthlyFeeMinor)}/mo
                                                    {t.terms.unitEventType ? ` + ${formatMinor(t.terms.unitPriceMinor)} per ${t.terms.unitEventType}` : ''}
                                                </span>
                                            ) : (
                                                <Badge variant="default">Not set</Badge>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Link href={`/admin/billing/${t.id}`} className="inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200">
                                                <Receipt className="w-4 h-4" /> Open
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
