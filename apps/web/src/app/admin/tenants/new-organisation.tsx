'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, Plus } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, Button, DashboardInput, Select, TickPop, controlClasses } from '@bookingflow/ui';

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
        onError: (err: any) => toast.error(err?.response?.data?.message ?? "Couldn't create the business. Let's try again."),
    });

    const copy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error("Couldn't copy. Select the link and copy it by hand."); }
    };

    return (
        <>
            <Button onClick={() => { setOpen((o) => !o); setResult(null); }}>
                <Plus className="h-4 w-4" aria-hidden />
                Add a business
            </Button>

            {(open || result) && (
                <div className="basis-full order-last space-y-4">
                    {result && (
                        <Card>
                            <CardContent className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <TickPop key={result.tenant.id} size={40} label={`${result.tenant.name} created`} />
                                    <p className="font-semibold text-text">{result.tenant.name} is set up.</p>
                                </div>
                                {result.invite.sent ? (
                                    <p className="text-[15px] text-muted">
                                        An invite email was sent to {result.owner.email}. The link works for 7 days.
                                    </p>
                                ) : (
                                    <>
                                        <p className="rounded-control bg-warning-soft px-3 py-2 text-[15px] text-warning-fg">
                                            {result.invite.reason === 'email_not_configured'
                                                ? 'Email is not configured on the platform, so no invite was sent.'
                                                : 'The invite email could not be sent.'}{' '}
                                            Pass this link to {result.owner.name} ({result.owner.email}). It works for 7 days, can be used once, and is shown only now.
                                        </p>
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                            <input
                                                aria-label="Invite link"
                                                readOnly
                                                value={result.invite.link ?? ''}
                                                onFocus={(e) => e.currentTarget.select()}
                                                className={`${controlClasses} font-mono text-[13px]`}
                                            />
                                            <Button variant="secondary" onClick={() => copy(result.invite.link ?? '')}>
                                                <Copy className="h-4 w-4" aria-hidden />
                                                Copy
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {open && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Add a business</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form
                                    onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
                                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                >
                                    <DashboardInput label="Business name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
                                    <Select label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                                            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                                        </Select>
                                    <Select label="Vertical" value={vertical} onChange={(e) => setVertical(e.target.value as 'APPOINTMENTS' | 'RIDES')}>
                                            <option value="APPOINTMENTS">Appointments</option>
                                            <option value="RIDES">Rides</option>
                                        </Select>
                                    <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value as 'free' | 'starter' | 'pro')}>
                                            <option value="free">Free</option>
                                            <option value="starter">Starter</option>
                                            <option value="pro">Pro</option>
                                        </Select>
                                    <DashboardInput label="Message quota override (blank = plan default)" type="number" min={0} max={1000000} step={1} value={quota} onChange={(e) => setQuota(e.target.value)} />
                                    <div className="hidden lg:block" />
                                    <DashboardInput label="Owner name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required minLength={2} />
                                    <DashboardInput label="Owner email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
                                    <div className="flex flex-wrap items-end gap-2">
                                        <Button type="submit" isLoading={create.isPending}>Create and invite owner</Button>
                                        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
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
