'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, Ticket, Pause, Play } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { BooklyDots } from '@/components/primitives/bookly-dots';

interface PromoCode {
    id: string;
    code: string;
    kind: 'TRIAL_EXTENSION' | 'PLAN_GRANT';
    days: number;
    planId: string | null;
    description: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    expiresAt: string | null;
    isActive: boolean;
    createdAt: string;
    createdBy: { name: string } | null;
}

interface Redemption {
    id: string;
    redeemedAt: string;
    tenant: { id: string; name: string };
    effect: { to?: { planId?: string; trialEndsAt?: string } } | null;
}

const KIND_LABEL: Record<PromoCode['kind'], string> = {
    TRIAL_EXTENSION: 'Extend trial',
    PLAN_GRANT: 'Grant a plan',
};

export default function AdminPromoCodesPage() {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState<string | null>(null);

    // Create form
    const [kind, setKind] = useState<PromoCode['kind']>('TRIAL_EXTENSION');
    const [planId, setPlanId] = useState<'starter' | 'pro'>('pro');
    const [days, setDays] = useState('30');
    const [code, setCode] = useState('');
    const [prefix, setPrefix] = useState('');
    const [description, setDescription] = useState('');
    const [maxRedemptions, setMaxRedemptions] = useState('');
    const [expiresAt, setExpiresAt] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'promo-codes'],
        queryFn: async () => (await adminApi.get('/admin/promo-codes')).data as { data: PromoCode[] },
    });

    const { data: redemptions } = useQuery({
        queryKey: ['admin', 'promo-codes', open, 'redemptions'],
        queryFn: async () => (await adminApi.get(`/admin/promo-codes/${open}/redemptions`)).data as { data: Redemption[] },
        enabled: !!open,
    });

    const create = useMutation({
        mutationFn: async () => {
            const body: Record<string, unknown> = {
                kind,
                days: Number(days),
                ...(kind === 'PLAN_GRANT' ? { planId } : {}),
                ...(code.trim() ? { code: code.trim() } : prefix.trim() ? { prefix: prefix.trim() } : {}),
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(maxRedemptions.trim() ? { maxRedemptions: Number(maxRedemptions) } : {}),
                ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
            };
            return (await adminApi.post('/admin/promo-codes', body)).data as PromoCode;
        },
        onSuccess: (created) => {
            toast.success(`Created ${created.code}`);
            setCode(''); setPrefix(''); setDescription(''); setMaxRedemptions(''); setExpiresAt('');
            queryClient.invalidateQueries({ queryKey: ['admin', 'promo-codes'] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Could not create the code'),
    });

    const toggle = useMutation({
        mutationFn: async (p: PromoCode) =>
            (await adminApi.patch(`/admin/promo-codes/${p.id}`, { isActive: !p.isActive })).data as PromoCode,
        onSuccess: (p) => {
            toast.success(p.isActive ? `${p.code} is active` : `${p.code} paused`);
            queryClient.invalidateQueries({ queryKey: ['admin', 'promo-codes'] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Could not update the code'),
    });

    const copy = async (c: string) => {
        try { await navigator.clipboard.writeText(c); toast.success('Copied'); } catch { toast.error('Could not copy'); }
    };

    const describe = (p: PromoCode) =>
        p.kind === 'PLAN_GRANT'
            ? `${p.days} days of ${p.planId === 'starter' ? 'Starter' : 'Pro'}`
            : `+${p.days} days of trial`;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Promo codes</h1>
                <p className="text-slate-400">
                    A business owner types the code under Settings → Plan &amp; Usage. Extend a trial, or put them on a plan for a while, no card needed.
                </p>
            </div>

            <Card className="glass-card border-white/5">
                <CardHeader>
                    <CardTitle>
                        <Ticket className="w-5 h-5 text-emerald-400" />
                        New code
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                        <label className="space-y-1.5">
                            <span className="block text-[13px] font-medium text-slate-300">What it does</span>
                            <select
                                value={kind}
                                onChange={(e) => setKind(e.target.value as PromoCode['kind'])}
                                className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                            >
                                <option value="TRIAL_EXTENSION">Extend the trial by N days</option>
                                <option value="PLAN_GRANT">Grant a plan for N days</option>
                            </select>
                        </label>
                        {kind === 'PLAN_GRANT' && (
                            <label className="space-y-1.5">
                                <span className="block text-[13px] font-medium text-slate-300">Plan</span>
                                <select
                                    value={planId}
                                    onChange={(e) => setPlanId(e.target.value as 'starter' | 'pro')}
                                    className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                                >
                                    <option value="pro">Pro</option>
                                    <option value="starter">Starter</option>
                                </select>
                            </label>
                        )}
                        <DashboardInput label="Days" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} required />
                        <DashboardInput label="Code (leave blank to generate)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH50" />
                        <DashboardInput label="Prefix for generated codes" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="LAUNCH" disabled={!!code} />
                        <DashboardInput label="Max uses (blank = unlimited)" type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="100" />
                        <DashboardInput label="Expires on (blank = never)" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                        <DashboardInput label="Note (internal)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Instagram launch campaign" className="md:col-span-2" />
                        <div className="flex items-end">
                            <Button type="submit" isLoading={create.isPending}>Create code</Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48"><BooklyDots size="md" /></div>
                ) : !data?.data.length ? (
                    <div className="p-10 text-center text-slate-400">No codes yet. Create the first one above.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                    <th className="px-6 py-4 font-medium">Code</th>
                                    <th className="px-6 py-4 font-medium">Does</th>
                                    <th className="px-6 py-4 font-medium">Used</th>
                                    <th className="px-6 py-4 font-medium">Expires</th>
                                    <th className="px-6 py-4 font-medium">Status</th>
                                    <th className="px-6 py-4 font-medium">Note</th>
                                    <th className="px-6 py-4 font-medium w-1"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.data.map((p) => {
                                    const expired = p.expiresAt ? new Date(p.expiresAt).getTime() < Date.now() : false;
                                    const exhausted = p.maxRedemptions !== null && p.redemptionCount >= p.maxRedemptions;
                                    return (
                                        <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                            <td className="px-6 py-4">
                                                <button onClick={() => copy(p.code)} className="inline-flex items-center gap-2 font-mono text-white hover:text-emerald-300" title="Copy">
                                                    {p.code} <Copy className="w-3.5 h-3.5 text-slate-500" />
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-300">{KIND_LABEL[p.kind]}: {describe(p)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-300 tabular-nums">
                                                <button onClick={() => setOpen(open === p.id ? null : p.id)} className="underline underline-offset-2 hover:text-white">
                                                    {p.redemptionCount}{p.maxRedemptions !== null ? ` / ${p.maxRedemptions}` : ''}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-300">{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('en-GB') : 'Never'}</td>
                                            <td className="px-6 py-4">
                                                {!p.isActive ? <Badge variant="default">Paused</Badge>
                                                    : expired ? <Badge variant="yellow">Expired</Badge>
                                                    : exhausted ? <Badge variant="yellow">Used up</Badge>
                                                    : <Badge variant="default" dot>Active</Badge>}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-400 max-w-[24ch] truncate">{p.description ?? ''}</td>
                                            <td className="px-6 py-4">
                                                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(p)} disabled={toggle.isPending} aria-label={p.isActive ? 'Pause' : 'Resume'}>
                                                    {p.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {open && (
                <Card className="glass-card border-white/5">
                    <CardHeader>
                        <CardTitle>Redemptions for {data?.data.find((p) => p.id === open)?.code}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!redemptions ? (
                            <BooklyDots size="sm" />
                        ) : redemptions.data.length === 0 ? (
                            <p className="text-sm text-slate-400">Nobody has used this code yet.</p>
                        ) : (
                            <ul className="divide-y divide-white/5">
                                {redemptions.data.map((r) => (
                                    <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                                        <span className="text-white">{r.tenant.name}</span>
                                        <span className="text-slate-400">
                                            {new Date(r.redeemedAt).toLocaleString('en-GB')}
                                            {r.effect?.to?.trialEndsAt ? ` · until ${new Date(r.effect.to.trialEndsAt).toLocaleDateString('en-GB')}` : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
