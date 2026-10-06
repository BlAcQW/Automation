'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, DashboardInput } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { formatMinor, parseMajorToMinor } from '../money';

interface Terms {
    currency: string;
    setupFeeMinor: number;
    monthlyFeeMinor: number;
    unitPriceMinor: number;
    unitEventType: string | null;
    notes: string | null;
}
interface TermsResponse {
    tenant: { id: string; name: string; vertical: string; planId: string; timezone: string };
    terms: Terms | null;
    canEdit: boolean;
}
interface EventTypeRow { type: string; description: string; highVolume: boolean }
interface Statement {
    tenantName: string | null;
    period: { month: string; timezone: string };
    isFinal: boolean;
    currency: string | null;
    unitEventType: string | null;
    unitCount: number;
    lines: Array<{ code: string; description: string; quantity: number; unitAmountMinor: number; amountMinor: number }>;
    totalMinor: number;
    notes: string[];
}

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .statement-print, .statement-print * { visibility: visible !important; color: #000 !important; background: #fff !important; border-color: #ccc !important; }
  .statement-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
}`;

const SELECT_CLASS = 'w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60';

export default function AdminTenantBillingPage() {
    const { tenantId } = useParams<{ tenantId: string }>();
    const queryClient = useQueryClient();

    const [month, setMonth] = useState(''); // '' = current month in the organisation's timezone
    const [currency, setCurrency] = useState('GHS');
    const [setupFee, setSetupFee] = useState('0.00');
    const [monthlyFee, setMonthlyFee] = useState('0.00');
    const [unitPrice, setUnitPrice] = useState('0.00');
    const [unitEventType, setUnitEventType] = useState('');
    const [notes, setNotes] = useState('');

    const termsQuery = useQuery({
        queryKey: ['admin', 'billing', tenantId, 'terms'],
        queryFn: async () => (await adminApi.get(`/admin/billing/tenants/${tenantId}/terms`)).data as TermsResponse,
    });
    const eventTypes = useQuery({
        queryKey: ['admin', 'billing', 'event-types'],
        queryFn: async () => (await adminApi.get('/admin/billing/event-types')).data as { data: EventTypeRow[] },
    });
    const statementQuery = useQuery({
        queryKey: ['admin', 'billing', tenantId, 'statement', month],
        queryFn: async () => {
            const qs = month ? `?month=${month}` : '';
            return (await adminApi.get(`/admin/billing/tenants/${tenantId}/statement${qs}`)).data as Statement;
        },
    });

    // Load the saved terms into the form once.
    const loaded = termsQuery.data;
    useEffect(() => {
        const t = loaded?.terms;
        if (!t) return;
        setCurrency(t.currency);
        setSetupFee(formatMinor(t.setupFeeMinor));
        setMonthlyFee(formatMinor(t.monthlyFeeMinor));
        setUnitPrice(formatMinor(t.unitPriceMinor));
        setUnitEventType(t.unitEventType ?? '');
        setNotes(t.notes ?? '');
    }, [loaded]);

    const canEdit = loaded?.canEdit ?? false;
    const setup = parseMajorToMinor(setupFee);
    const monthly = parseMajorToMinor(monthlyFee);
    const unit = parseMajorToMinor(unitPrice);
    const valid = setup !== null && monthly !== null && unit !== null && /^[A-Z]{3}$/.test(currency);

    const save = useMutation({
        mutationFn: async () =>
            (await adminApi.put(`/admin/billing/tenants/${tenantId}/terms`, {
                currency,
                setupFeeMinor: setup,
                monthlyFeeMinor: monthly,
                unitPriceMinor: unit,
                unitEventType: unitEventType || null,
                notes: notes.trim() || null,
            })).data,
        onSuccess: () => {
            toast.success('Billing terms saved');
            queryClient.invalidateQueries({ queryKey: ['admin', 'billing', tenantId] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Could not save the terms'),
    });

    const downloadCsv = async () => {
        try {
            const qs = month ? `?month=${month}` : '';
            const res = await adminApi.get(`/admin/billing/tenants/${tenantId}/statement.csv${qs}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data as Blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `statement-${statementQuery.data?.period.month ?? 'current'}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch {
            toast.error('Could not download the statement');
        }
    };

    const statement = statementQuery.data;
    const selectedType = eventTypes.data?.data.find((e) => e.type === unitEventType);

    if (termsQuery.isLoading) {
        return <div className="flex items-center justify-center h-64"><BooklyDots size="md" /></div>;
    }
    if (!loaded) {
        return <div className="p-10 text-center text-slate-400">Organisation not found.</div>;
    }

    return (
        <div className="space-y-6">
            <style>{PRINT_CSS}</style>
            <div>
                <Link href="/admin/billing" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
                    <ArrowLeft className="w-4 h-4" /> All organisations
                </Link>
                <h1 className="text-2xl font-bold text-white mt-2">{loaded.tenant.name}</h1>
                <p className="text-slate-400">
                    {loaded.tenant.vertical === 'RIDES' ? 'Rides' : 'Appointments'} · {loaded.tenant.planId} plan · {loaded.tenant.timezone}
                </p>
            </div>

            <Card className="glass-card border-white/5">
                <CardHeader>
                    <CardTitle>Custom billing terms</CardTitle>
                </CardHeader>
                <CardContent>
                    {!canEdit && (
                        <p className="mb-4 text-sm text-amber-300">Read only. Only an owner or finance admin can change billing terms.</p>
                    )}
                    <form
                        onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                        <DashboardInput label="Currency" value={currency} maxLength={3} disabled={!canEdit}
                            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                            error={/^[A-Z]{3}$/.test(currency) ? undefined : 'Use a 3-letter code, e.g. GHS'} />
                        <DashboardInput label="Setup fee (once, first month)" inputMode="decimal" value={setupFee} disabled={!canEdit}
                            onChange={(e) => setSetupFee(e.target.value)}
                            error={setup === null ? 'Enter an amount like 250 or 250.50' : undefined} />
                        <DashboardInput label="Monthly fee" inputMode="decimal" value={monthlyFee} disabled={!canEdit}
                            onChange={(e) => setMonthlyFee(e.target.value)}
                            error={monthly === null ? 'Enter an amount like 250 or 250.50' : undefined} />
                        <label className="space-y-1.5">
                            <span className="block text-[13px] font-medium text-slate-300">Billable unit (an event)</span>
                            <select value={unitEventType} disabled={!canEdit} onChange={(e) => setUnitEventType(e.target.value)} className={SELECT_CLASS}>
                                <option value="">No usage billing</option>
                                {eventTypes.data?.data.map((e) => (
                                    <option key={e.type} value={e.type}>{e.type}</option>
                                ))}
                            </select>
                            {selectedType && (
                                <span className="block text-xs text-slate-500">
                                    {selectedType.description}.
                                    {selectedType.highVolume ? ' These events are always stored for this organisation so the count is complete.' : ''}
                                </span>
                            )}
                        </label>
                        <DashboardInput label="Price per unit" inputMode="decimal" value={unitPrice} disabled={!canEdit || !unitEventType}
                            onChange={(e) => setUnitPrice(e.target.value)}
                            error={unit === null ? 'Enter an amount like 0.25' : undefined} />
                        <DashboardInput label="Note (internal)" value={notes} disabled={!canEdit} maxLength={500}
                            onChange={(e) => setNotes(e.target.value)} placeholder="Agreed on a call, pilot rate" />
                        {canEdit && (
                            <div className="flex items-end">
                                <Button type="submit" isLoading={save.isPending} disabled={!valid}>Save terms</Button>
                            </div>
                        )}
                    </form>
                    <p className="mt-4 text-xs text-slate-500">
                        Statements use the current terms for the whole month, so a change re-prices the month it is made in. The setup fee is charged in the month these terms were first saved.
                    </p>
                </CardContent>
            </Card>

            <Card className="glass-card border-white/5">
                <CardHeader>
                    <CardTitle>Statement</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-end gap-4 mb-6 print:hidden">
                        <label className="space-y-1.5">
                            <span className="block text-[13px] font-medium text-slate-300">Month</span>
                            <input
                                type="month"
                                value={month}
                                onChange={(e) => setMonth(e.target.value)}
                                className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                            />
                        </label>
                        <Button variant="ghost" onClick={() => window.print()} disabled={!statement}>
                            <Printer className="w-4 h-4" /> Print
                        </Button>
                        <Button variant="ghost" onClick={downloadCsv} disabled={!statement}>
                            <Download className="w-4 h-4" /> Download CSV
                        </Button>
                    </div>

                    {statementQuery.isLoading ? (
                        <BooklyDots size="sm" />
                    ) : statementQuery.isError || !statement ? (
                        <p className="text-sm text-rose-300">Could not load the statement for that month.</p>
                    ) : (
                        <div className="statement-print space-y-4">
                            <div>
                                <div className="text-lg font-semibold text-white">{statement.tenantName ?? loaded.tenant.name}</div>
                                <div className="text-sm text-slate-400">
                                    Statement for {statement.period.month} ({statement.period.timezone})
                                    {' '}
                                    {statement.isFinal ? null : <Badge variant="yellow">Month in progress</Badge>}
                                </div>
                            </div>
                            {statement.lines.length === 0 ? (
                                <p className="text-sm text-slate-400">Nothing to bill for this month.</p>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                            <th className="py-3 font-medium">Item</th>
                                            <th className="py-3 font-medium text-right">Qty</th>
                                            <th className="py-3 font-medium text-right">Unit</th>
                                            <th className="py-3 font-medium text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {statement.lines.map((l) => (
                                            <tr key={l.code} className="border-b border-white/5 text-sm text-slate-200 tabular-nums">
                                                <td className="py-3">{l.description}</td>
                                                <td className="py-3 text-right">{l.quantity.toLocaleString('en-GB')}</td>
                                                <td className="py-3 text-right">{formatMinor(l.unitAmountMinor)}</td>
                                                <td className="py-3 text-right">{formatMinor(l.amountMinor)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            <div className="flex justify-end text-white text-lg font-semibold tabular-nums">
                                Total {statement.currency ?? ''} {formatMinor(statement.totalMinor)}
                            </div>
                            {statement.notes.map((n) => (
                                <p key={n} className="text-xs text-slate-500">{n}</p>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
