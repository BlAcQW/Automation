'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { adminApi } from '@/lib/api';
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DashboardInput,
    EmptyState,
    ErrorState,
    PageHeader,
    Select,
    SkeletonCard,
    SkeletonLine,
    StatusPill,
    controlClasses,
} from '@bookingflow/ui';
import { formatMinor, parseMajorToMinor } from '../money';
import { formatMinor as formatMoney } from '../../_components/format';

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
        onError: (err: any) => toast.error(err?.response?.data?.message ?? "Couldn't save the terms. Let's try again."),
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
            toast.error("Couldn't download the statement. Let's try again.");
        }
    };

    const statement = statementQuery.data;
    const selectedType = eventTypes.data?.data.find((e) => e.type === unitEventType);

    const backLink = (
        <Link href="/admin/billing" className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-medium text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden /> All businesses
        </Link>
    );

    if (termsQuery.isLoading) {
        return (
            <div className="space-y-6" aria-busy="true">
                <span className="sr-only">Loading…</span>
                <SkeletonCard />
                <SkeletonCard />
            </div>
        );
    }
    if (!loaded) {
        return (
            <div className="space-y-4">
                {backLink}
                <Card><EmptyState title="Business not found" description="It may have been deleted. Go back to the list and pick another." /></Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <style>{PRINT_CSS}</style>
            <PageHeader
                eyebrow={backLink}
                title={loaded.tenant.name}
                subtitle={`${loaded.tenant.vertical === 'RIDES' ? 'Rides' : 'Appointments'} · ${loaded.tenant.planId} plan · ${loaded.tenant.timezone}`}
            />

            <Card>
                <CardHeader>
                    <CardTitle>Custom billing terms</CardTitle>
                </CardHeader>
                <CardContent>
                    {!canEdit && (
                        <p className="mb-4 rounded-control bg-warning-soft px-3 py-2 text-[14px] text-warning-fg">View only. Only an owner or finance admin can change billing terms.</p>
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
                        <Select
                            label="Billable unit (an event)"
                            value={unitEventType}
                            disabled={!canEdit}
                            onChange={(e) => setUnitEventType(e.target.value)}
                            hint={selectedType ? `${selectedType.description}.${selectedType.highVolume ? ' These events are always stored for this business so the count is complete.' : ''}` : undefined}
                        >
                            <option value="">No usage billing</option>
                            {eventTypes.data?.data.map((e) => (
                                <option key={e.type} value={e.type}>{e.type}</option>
                            ))}
                        </Select>
                        <DashboardInput label="Price per unit" inputMode="decimal" value={unitPrice} disabled={!canEdit || !unitEventType}
                            onChange={(e) => setUnitPrice(e.target.value)}
                            error={unit === null ? 'Enter an amount like 0.25' : undefined} />
                        <DashboardInput label="Note (only admins see it)" value={notes} disabled={!canEdit} maxLength={500}
                            onChange={(e) => setNotes(e.target.value)} placeholder="Agreed on a call, pilot rate" />
                        {canEdit && (
                            <div className="flex items-end">
                                <Button type="submit" isLoading={save.isPending} disabled={!valid}>Save terms</Button>
                            </div>
                        )}
                    </form>
                    <p className="mt-4 text-[13px] text-muted">
                        Statements use the current terms for the whole month, so a change re-prices the month it is made in. The setup fee is charged in the month these terms were first saved.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Statement</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
                        <div className="w-full space-y-1.5 sm:w-56">
                            <label htmlFor="statement-month" className="block text-[14px] font-medium text-text">Month</label>
                            <input
                                id="statement-month"
                                type="month"
                                value={month}
                                onChange={(e) => setMonth(e.target.value)}
                                className={controlClasses}
                            />
                        </div>
                        <Button variant="secondary" onClick={() => window.print()} disabled={!statement}>
                            <Printer className="h-4 w-4" aria-hidden /> Print
                        </Button>
                        <Button variant="secondary" onClick={downloadCsv} disabled={!statement}>
                            <Download className="h-4 w-4" aria-hidden /> Download CSV
                        </Button>
                    </div>

                    {statementQuery.isLoading ? (
                        <div aria-busy="true" className="space-y-3">
                            <span className="sr-only">Loading the statement…</span>
                            <SkeletonLine width="w-1/2" />
                            <SkeletonLine />
                            <SkeletonLine width="w-4/5" />
                        </div>
                    ) : statementQuery.isError || !statement ? (
                        <ErrorState
                            title="We couldn't load the statement for that month"
                            onRetry={() => statementQuery.refetch()}
                            isRetrying={statementQuery.isRefetching}
                        />
                    ) : (
                        <div className="statement-print space-y-4">
                            <div>
                                <div className="text-section-heading text-text">{statement.tenantName ?? loaded.tenant.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-muted">
                                    Statement for {statement.period.month} ({statement.period.timezone})
                                    {statement.isFinal ? null : <StatusPill size="sm" status="pending" label="Month in progress" />}
                                </div>
                            </div>
                            {statement.lines.length === 0 ? (
                                <p className="text-[15px] text-muted">Nothing to bill for this month.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border text-left text-[13px] text-muted">
                                                <th className="py-3 pr-3 font-semibold">Item</th>
                                                <th className="py-3 pr-3 text-right font-semibold">Qty</th>
                                                <th className="hidden py-3 pr-3 text-right font-semibold sm:table-cell">Unit</th>
                                                <th className="py-3 text-right font-semibold">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {statement.lines.map((l) => (
                                                <tr key={l.code} className="border-b border-border text-[15px] tabular-nums text-text">
                                                    <td className="py-3 pr-3">{l.description}<span className="block text-[13px] text-muted sm:hidden">{formatMoney(l.unitAmountMinor, statement.currency)} each</span></td>
                                                    <td className="py-3 pr-3 text-right">{l.quantity.toLocaleString('en-GB')}</td>
                                                    <td className="hidden whitespace-nowrap py-3 pr-3 text-right sm:table-cell">{formatMoney(l.unitAmountMinor, statement.currency)}</td>
                                                    <td className="whitespace-nowrap py-3 text-right">{formatMoney(l.amountMinor, statement.currency)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div className="flex justify-end text-section-heading tabular-nums text-text">
                                Total {formatMoney(statement.totalMinor, statement.currency)}
                            </div>
                            {statement.notes.map((n) => (
                                <p key={n} className="text-[13px] text-muted">{n}</p>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
