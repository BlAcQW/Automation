'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../admin-context';
import { UserCog, ShieldOff, Plus } from 'lucide-react';
import {
    Button,
    Card,
    ConfirmDialog,
    EmptyState,
    ErrorState,
    Input,
    Modal,
    PageHeader,
    Select,
    SkeletonTableRow,
    StatusPill,
} from '@bookingflow/ui';
import toast from 'react-hot-toast';
import { errorMessage, formatDateTime, ROLE_LABEL } from '../_components/format';
import { Table, THead, Td, Th, Tr } from '../_components/parts';

const ROLES = ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY'] as const;
const ROLE_HELP: Record<(typeof ROLES)[number], string> = {
    OWNER: 'Everything, including admins, deletions, workflows and platform-wide switches.',
    FINANCE: 'Money, billing and promo codes; payout switches; read-only elsewhere.',
    SUPPORT: 'Businesses, users, conversations, alerts, support access; no money.',
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

type Confirm = { kind: 'reset2fa' | 'deactivate'; row: AdminRow } | null;

export default function AdminAdminsPage() {
    const { admin, can } = useAdmin();
    const queryClient = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [confirm, setConfirm] = useState<Confirm>(null);
    const allowed = can('admins:manage');

    // No default role: whoever creates an admin has to choose their power on purpose.
    const emptyForm = { email: '', password: '', name: '', role: '' as '' | (typeof ROLES)[number] };
    const [form, setForm] = useState(emptyForm);

    const { data, isLoading, error, refetch, isRefetching } = useQuery({
        queryKey: ['admin', 'admins'],
        queryFn: async () => (await adminApi.get('/admin/admins')).data as { data: AdminRow[] },
        enabled: allowed,
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });

    const create = useMutation({
        mutationFn: async () => (await adminApi.post('/admin/admins', form)).data,
        onSuccess: () => {
            toast.success(`Admin ${form.email} added`);
            setShowCreate(false);
            setForm(emptyForm);
            refresh();
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't add the admin. Let's try again.")),
    });

    const update = useMutation({
        mutationFn: async (v: { id: string; body: { role?: string; isActive?: boolean } }) =>
            (await adminApi.patch(`/admin/admins/${v.id}`, v.body)).data,
        onSuccess: () => { toast.success('Admin updated'); setConfirm(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, "Couldn't update the admin. Let's try again.")),
    });

    const reset2fa = useMutation({
        mutationFn: async (id: string) => (await adminApi.post(`/admin/admins/${id}/reset-2fa`)).data,
        onSuccess: () => { toast.success('Two-step sign-in reset. They can set it up again next time they sign in.'); setConfirm(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, "Couldn't reset two-step sign-in. Let's try again.")),
    });

    if (!allowed) {
        return (
            <div className="space-y-6">
                <PageHeader title="Manage admins" />
                <Card>
                    <EmptyState
                        icon={<ShieldOff className="h-6 w-6" aria-hidden />}
                        title="Owner access needed"
                        description="Only owners can see or change the admin list."
                    />
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Manage admins"
                subtitle="Add administrators and choose what each role may do."
                actions={<Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" aria-hidden /> Add an admin</Button>}
            />

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading admins…</span>
                        {Array.from({ length: 4 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)}
                    </div>
                ) : error ? (
                    <ErrorState title="We couldn't load the admins" onRetry={() => refetch()} isRetrying={isRefetching} />
                ) : !data?.data?.length ? (
                    <EmptyState
                        icon={<UserCog className="h-6 w-6" aria-hidden />}
                        title="No admins yet"
                        action={<Button onClick={() => setShowCreate(true)}>Add an admin</Button>}
                    />
                ) : (
                    <Table>
                        <THead>
                            <tr>
                                <Th>Name</Th>
                                <Th>Email</Th>
                                <Th>Role</Th>
                                <Th>Two-step</Th>
                                <Th>Status</Th>
                                <Th>Last sign-in</Th>
                                <Th />
                            </tr>
                        </THead>
                        <tbody>
                            {data.data.map((a) => {
                                const isMe = a.id === admin?.id;
                                return (
                                    <Tr key={a.id}>
                                        <Td><span className="font-semibold">{a.name}</span>{isMe && <span className="ml-2 text-[13px] text-muted">(you)</span>}</Td>
                                        <Td label="Email" className="break-all">{a.email}</Td>
                                        <Td label="Role">
                                            <div className="min-w-[10rem]">
                                                <Select
                                                    aria-label={`Role for ${a.name}`}
                                                    value={a.role}
                                                    disabled={isMe || update.isPending}
                                                    onChange={(e) => update.mutate({ id: a.id, body: { role: e.target.value } })}
                                                >
                                                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                                                </Select>
                                            </div>
                                        </Td>
                                        <Td label="Two-step">
                                            <StatusPill size="sm" status={a.totpEnabledAt ? 'active' : 'inactive'} label={a.totpEnabledAt ? 'On' : 'Off'} />
                                        </Td>
                                        <Td label="Status">
                                            <StatusPill size="sm" status={a.isActive ? 'active' : 'inactive'} tone={a.isActive ? 'success' : 'error'} />
                                        </Td>
                                        <Td label="Last sign-in" className="whitespace-nowrap text-muted">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'Never'}</Td>
                                        <Td>
                                            {!isMe && (
                                                <div className="flex flex-wrap gap-2 md:justify-end">
                                                    {a.totpEnabledAt && (
                                                        <Button variant="secondary" size="sm" disabled={reset2fa.isPending}
                                                            onClick={() => setConfirm({ kind: 'reset2fa', row: a })}>
                                                            Reset two-step
                                                        </Button>
                                                    )}
                                                    <Button variant={a.isActive ? 'destructive' : 'secondary'} size="sm" disabled={update.isPending}
                                                        onClick={() => (a.isActive
                                                            ? setConfirm({ kind: 'deactivate', row: a })
                                                            : update.mutate({ id: a.id, body: { isActive: true } }))}>
                                                        {a.isActive ? 'Deactivate' : 'Reactivate'}
                                                    </Button>
                                                </div>
                                            )}
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            <ConfirmDialog
                isOpen={confirm?.kind === 'reset2fa'}
                onClose={() => setConfirm(null)}
                onConfirm={() => confirm && reset2fa.mutate(confirm.row.id)}
                title={`Reset two-step sign-in for ${confirm?.row.name ?? 'this admin'}?`}
                description="They lose their authenticator and recovery codes, and set it up again next time they sign in."
                confirmLabel="Reset"
                isLoading={reset2fa.isPending}
            />
            <ConfirmDialog
                isOpen={confirm?.kind === 'deactivate'}
                onClose={() => setConfirm(null)}
                onConfirm={() => confirm && update.mutate({ id: confirm.row.id, body: { isActive: false } })}
                title={`Deactivate ${confirm?.row.name ?? 'this admin'}?`}
                description="They can't sign in to the console until you reactivate them."
                confirmLabel="Deactivate"
                isLoading={update.isPending}
            />

            <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add an admin">
                <form onSubmit={(e) => { e.preventDefault(); if (form.role) create.mutate(); }} className="space-y-4">
                    <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
                    <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                    <Input label="Password" hint="At least 12 characters." type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} />
                    <Select
                        id="new-admin-role"
                        label="Role"
                        value={form.role}
                        onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}
                        required
                        hint={form.role ? ROLE_HELP[form.role] : undefined}
                    >
                        <option value="" disabled>Choose a role…</option>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="secondary" onClick={() => setShowCreate(false)} disabled={create.isPending}>Cancel</Button>
                        <Button type="submit" disabled={!form.role} isLoading={create.isPending} loadingText="Adding…">Add admin</Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
