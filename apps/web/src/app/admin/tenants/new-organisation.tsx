'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, Plus } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, Button, DashboardInput } from '@bookingflow/ui';

interface InviteResult {
    sent: boolean;
    link?: string;
    reason?: 'email_not_configured' | 'send_failed';
}

interface CreateResult {
    tenant: { id: string; name: string };
    owner: { name: string; email: string };
    invite: InviteResult;
}

const SELECT_CLASS =
    'w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

function timezones(): string[] {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = fn ? fn('timeZone') : [];
    return Array.from(new Set(['Africa/Accra', 'UTC', ...list])).sort();
}

export function NewOrganisation() {
    const queryClient = useQueryClient();
    const zones = useMemo(timezones, []);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [timezone, setTimezone] = useState('Africa/Accra');
    const [vertical, setVertical] = useState<'APPOINTMENTS' | 'RIDES'>('APPOINTMENTS');
    const [planId, setPlanId] = useState<'free' | 'starter' | 'pro'>('free');
    const [quota, setQuota] = useState('');
    const [ownerName, setOwnerName] = useState('');
    const [ownerEmail, setOwnerEmail] = useState('');
    const [result, setResult] = useState<CreateResult | null>(null);

    const reset = () => {
        setName(''); setQuota(''); setOwnerName(''); setOwnerEmail('');
        setTimezone('Africa/Accra'); setVertical('APPOINTMENTS'); setPlanId('free');
    };

    const create = useMutation({
        mutationFn: async () => {
            const body = {
                name: name.trim(),
                timezone,
                vertical,
                planId,
                ...(quota.trim() ? { monthlyMessageQuotaOverride: Number(quota) } : {}),
                owner: { name: ownerName.trim(), email: ownerEmail.trim() },
            };
            return (await adminApi.post('/admin/tenants', body)).data as CreateResult;
        },
        onSuccess: (data) => {
            setResult(data);
            reset();
            toast.success(`Created ${data.tenant.name}`);
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Could not create the organisation'),
    });

    const copy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Could not copy'); }
    };

    return (
        <>
            <Button onClick={() => { setOpen((o) => !o); setResult(null); }}>
                <Plus className="w-4 h-4 mr-2" />
                New organisation
            </Button>

            {(open || result) && (
                <div className="basis-full order-last space-y-4">
                    {result && (
                        <Card className="glass-card border-white/5">
                            <CardContent className="space-y-3 pt-6">
                                <p className="text-white font-medium">{result.tenant.name} created.</p>
                                {result.invite.sent ? (
                                    <p className="text-sm text-slate-300">
                                        An invite email was sent to {result.owner.email}. The link works for 7 days.
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-sm text-amber-300">
                                            {result.invite.reason === 'email_not_configured'
                                                ? 'Email is not configured on the platform, so no invite was sent.'
                                                : 'The invite email could not be sent.'}{' '}
                                            Pass this link to {result.owner.name} ({result.owner.email}). It works for 7 days, can be used once, and is shown only now.
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                readOnly
                                                value={result.invite.link ?? ''}
                                                onFocus={(e) => e.currentTarget.select()}
                                                className={`${SELECT_CLASS} font-mono text-xs`}
                                            />
                                            <Button variant="outline" onClick={() => copy(result.invite.link ?? '')}>
                                                <Copy className="w-4 h-4 mr-2" />
                                                Copy
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {open && (
                        <Card className="glass-card border-white/5">
                            <CardHeader>
                                <CardTitle>New organisation</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form
                                    onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
                                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                >
                                    <DashboardInput label="Organisation name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
                                    <label className="space-y-1.5">
                                        <span className="block text-[13px] font-medium text-slate-300">Timezone</span>
                                        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={SELECT_CLASS}>
                                            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                                        </select>
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="block text-[13px] font-medium text-slate-300">Vertical</span>
                                        <select value={vertical} onChange={(e) => setVertical(e.target.value as 'APPOINTMENTS' | 'RIDES')} className={SELECT_CLASS}>
                                            <option value="APPOINTMENTS">Appointments</option>
                                            <option value="RIDES">Rides</option>
                                        </select>
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="block text-[13px] font-medium text-slate-300">Plan</span>
                                        <select value={planId} onChange={(e) => setPlanId(e.target.value as 'free' | 'starter' | 'pro')} className={SELECT_CLASS}>
                                            <option value="free">Free</option>
                                            <option value="starter">Starter</option>
                                            <option value="pro">Pro</option>
                                        </select>
                                    </label>
                                    <DashboardInput label="Message quota override (blank = plan default)" type="number" min={0} max={1000000} step={1} value={quota} onChange={(e) => setQuota(e.target.value)} />
                                    <div className="hidden lg:block" />
                                    <DashboardInput label="Owner name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required minLength={2} />
                                    <DashboardInput label="Owner email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
                                    <div className="flex items-end gap-2">
                                        <Button type="submit" isLoading={create.isPending}>Create and invite owner</Button>
                                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </>
    );
}
