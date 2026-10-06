'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../admin-context';
import { UserCog, ShieldOff } from 'lucide-react';
import { Card, Badge, Button, Input, Modal } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import toast from 'react-hot-toast';
import { errorMessage, formatDateTime, ROLE_LABEL } from '../_components/format';

const ROLES = ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY'] as const;
const ROLE_HELP: Record<(typeof ROLES)[number], string> = {
    OWNER: 'Everything, including admins, deletions, workflows and platform-wide switches.',
    FINANCE: 'Money, billing and promo codes; payout switches; read-only elsewhere.',
    SUPPORT: 'Tenants, users, conversations, alerts, support access; no money.',
    READONLY: 'Can look at everything they are allowed to see; can change nothing.',
};

interface AdminRow {
    id: string;
    name: string;
    email: string;
    role: (typeof ROLES)[number];
    isActive: boolean;
    totpEnabledAt: string | null;
    lastLoginAt: string | null;
}

export default function AdminAdminsPage() {
    const { admin, can } = useAdmin();
    const queryClient = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const allowed = can('admins:manage');

    // No default role: whoever creates an admin has to choose their power on purpose.
    const emptyForm = { email: '', password: '', name: '', role: '' as '' | (typeof ROLES)[number] };
    const [form, setForm] = useState(emptyForm);

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'admins'],
        queryFn: async () => (await adminApi.get('/admin/admins')).data as { data: AdminRow[] },
        enabled: allowed,
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });

    const create = useMutation({
        mutationFn: async () => (await adminApi.post('/admin/admins', form)).data,
        onSuccess: () => {
            toast.success(`Admin ${form.email} created`);
            setShowCreate(false);
            setForm(emptyForm);
            refresh();
        },
        onError: (err) => toast.error(errorMessage(err, 'Failed to create admin')),
    });

    const update = useMutation({
        mutationFn: async (v: { id: string; body: { role?: string; isActive?: boolean } }) =>
            (await adminApi.patch(`/admin/admins/${v.id}`, v.body)).data,
        onSuccess: () => { toast.success('Admin updated'); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not update the admin')),
    });

    const reset2fa = useMutation({
        mutationFn: async (id: string) => (await adminApi.post(`/admin/admins/${id}/reset-2fa`)).data,
        onSuccess: () => { toast.success('Two-factor reset. They can set it up again at next sign-in.'); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not reset two-factor')),
    });

    if (!allowed) {
        return (
            <div className="space-y-6">
                <h1 className="text-2xl font-bold text-white">Manage Admins</h1>
                <Card className="glass-card border-white/5 p-12 text-center">
                    <ShieldOff className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-300 font-medium">Owner access required</p>
                    <p className="text-slate-500 text-sm mt-1">Only owners can view or manage the admin list.</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Manage Admins</h1>
                    <p className="text-slate-400">Add administrators and choose what each role may do.</p>
                </div>
                <Button onClick={() => setShowCreate(true)}>+ New Admin</Button>
            </div>

            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64"><BooklyDots size="md" /></div>
                ) : error ? (
                    <div className="p-6 text-red-400">Failed to load admins.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                    <th className="px-6 py-4 font-medium">Name</th>
                                    <th className="px-6 py-4 font-medium">Email</th>
                                    <th className="px-6 py-4 font-medium">Role</th>
                                    <th className="px-6 py-4 font-medium">2FA</th>
                                    <th className="px-6 py-4 font-medium">Status</th>
                                    <th className="px-6 py-4 font-medium">Last Login</th>
                                    <th className="px-6 py-4 font-medium" />
                                </tr>
                            </thead>
                            <tbody>
                                {!data?.data?.length ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center">
                                            <UserCog className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                            <p className="text-slate-400">No admins found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    data.data.map((a) => {
                                        const isMe = a.id === admin?.id;
                                        return (
                                            <tr key={a.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 text-white font-medium">{a.name}{isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}</td>
                                                <td className="px-6 py-4 text-slate-300">{a.email}</td>
                                                <td className="px-6 py-4">
                                                    <select
                                                        aria-label={`Role for ${a.name}`}
                                                        value={a.role}
                                                        disabled={isMe || update.isPending}
                                                        onChange={(e) => update.mutate({ id: a.id, body: { role: e.target.value } })}
                                                        className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-white disabled:opacity-50"
                                                    >
                                                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                                                    </select>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <Badge variant={a.totpEnabledAt ? 'default' : 'slate'}>{a.totpEnabledAt ? 'On' : 'Off'}</Badge>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <Badge variant={a.isActive ? 'default' : 'red'}>{a.isActive ? 'Active' : 'Inactive'}</Badge>
                                                </td>
                                                <td className="px-6 py-4 text-slate-400 text-sm">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'Never'}</td>
                                                <td className="px-6 py-4">
                                                    {!isMe && (
                                                        <div className="flex gap-2 justify-end">
                                                            {a.totpEnabledAt && (
                                                                <Button variant="outline" size="sm" disabled={reset2fa.isPending}
                                                                    onClick={() => { if (window.confirm(`Reset two-factor for ${a.name}? They lose their authenticator and recovery codes.`)) reset2fa.mutate(a.id); }}>
                                                                    Reset 2FA
                                                                </Button>
                                                            )}
                                                            <Button variant={a.isActive ? 'destructive' : 'outline'} size="sm" disabled={update.isPending}
                                                                onClick={() => update.mutate({ id: a.id, body: { isActive: !a.isActive } })}>
                                                                {a.isActive ? 'Deactivate' : 'Reactivate'}
                                                            </Button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Admin">
                <form onSubmit={(e) => { e.preventDefault(); if (form.role) create.mutate(); }} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Name</label>
                        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Email</label>
                        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Password</label>
                        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300" htmlFor="new-admin-role">Role</label>
                        <select
                            id="new-admin-role"
                            value={form.role}
                            onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}
                            required
                            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white"
                        >
                            <option value="" disabled>Choose a role…</option>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                        {form.role && <p className="text-xs text-slate-500">{ROLE_HELP[form.role]}</p>}
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => setShowCreate(false)} disabled={create.isPending}>Cancel</Button>
                        <Button type="submit" disabled={create.isPending || !form.role}>{create.isPending ? 'Creating…' : 'Create'}</Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
