'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Copy, KeyRound, Mail, MessageCircle } from 'lucide-react';
import { Badge, Button, Modal } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Empty, Panel, Table, Td, Th } from '../../_components/parts';
import { errorMessage, formatDateTime } from '../../_components/format';

export interface Person {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
}

interface LinkOption {
    label: string;
    origin: string;
    resetUrl: string;
    isDefault: boolean;
}

interface IssuedLink {
    link: string;
    expiresAt: string;
}

type Pending = { kind: 'email' | 'link'; person: Person } | null;

/**
 * The organisation's people, with account-recovery actions.
 *  - "Send reset email" (users:write: OWNER, SUPPORT) sends the standard
 *    Bookly reset email.
 *  - "Copy reset link" (users:reset_link: OWNER) mints a one-hour link to
 *    pass on by WhatsApp. It is held only in this component's state while
 *    the dialog is open, never stored.
 * The API enforces both permissions; the buttons only mirror them. Admins
 * never see or set the password.
 */
export function PeoplePanel({
    tenantId, tenantActive, vertical, people,
}: {
    tenantId: string;
    tenantActive: boolean;
    vertical: string;
    people: Person[];
}) {
    const { can } = useAdmin();
    const [pending, setPending] = useState<Pending>(null);
    const mayEmail = can('users:write');
    const mayLink = can('users:reset_link');

    const sendEmail = useMutation({
        mutationFn: async (p: Person) =>
            (await adminApi.post(`/admin/tenants/${tenantId}/users/${p.id}/password-reset/email`)).data as { email: string },
        onSuccess: (d) => {
            toast.success(`Reset email sent to ${d.email} — ask them to check Spam`);
            setPending(null);
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not send the reset email')),
    });

    return (
        <Panel title={`People (${people.length})`}>
            {!people.length ? <Empty>No users.</Empty> : (
                <Table>
                    <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th /></tr></thead>
                    <tbody>
                        {people.map((u) => {
                            const canRecover = tenantActive && u.isActive;
                            return (
                                <tr key={u.id} className="border-t border-white/5">
                                    <Td className="text-white">{u.name}</Td>
                                    <Td>{u.email}</Td>
                                    <Td>{u.role}</Td>
                                    <Td><Badge variant={u.isActive ? 'default' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                                    <Td>
                                        {canRecover && (mayEmail || mayLink) && (
                                            <div className="flex flex-wrap justify-end gap-2">
                                                {mayEmail && (
                                                    <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'email', person: u })}>
                                                        <Mail className="h-4 w-4" /> Send reset email
                                                    </Button>
                                                )}
                                                {mayLink && (
                                                    <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'link', person: u })}>
                                                        <KeyRound className="h-4 w-4" /> Copy reset link
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </Td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}

            <Modal isOpen={pending?.kind === 'email'} onClose={() => setPending(null)} title="Send a password reset email">
                {pending?.kind === 'email' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">
                            Bookly will email <span className="text-white">{pending.person.email}</span> the standard reset link. It works once, for one hour, and opens the Bookly reset page. You will not see the link or the new password.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setPending(null)} disabled={sendEmail.isPending}>Cancel</Button>
                            <Button type="button" onClick={() => sendEmail.mutate(pending.person)} isLoading={sendEmail.isPending}>
                                <Mail className="h-4 w-4" /> Send email
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {mayLink && (
                <ResetLinkModal
                    tenantId={tenantId}
                    vertical={vertical}
                    person={pending?.kind === 'link' ? pending.person : null}
                    onClose={() => setPending(null)}
                />
            )}
        </Panel>
    );
}

function ResetLinkModal({
    tenantId, vertical, person, onClose,
}: {
    tenantId: string;
    vertical: string;
    person: Person | null;
    onClose: () => void;
}) {
    const [resetUrl, setResetUrl] = useState('');
    const [issued, setIssued] = useState<IssuedLink | null>(null);
    const isOpen = person !== null;

    const options = useQuery({
        queryKey: ['admin', 'password-reset-link-options'],
        queryFn: async () => (await adminApi.get('/admin/password-reset/link-options')).data.data as LinkOption[],
        enabled: isOpen,
        staleTime: 5 * 60 * 1000,
    });

    // Fresh state every time the dialog opens; the link is dropped on close.
    // A RIDES organisation's people usually sign in on the operator's own
    // console, so preselect the first non-Bookly page when there is one.
    useEffect(() => {
        if (!isOpen) { setIssued(null); setResetUrl(''); return; }
        const list = options.data ?? [];
        const consoleOption = vertical === 'RIDES' ? list.find((o) => !o.isDefault) : undefined;
        setResetUrl((consoleOption ?? list.find((o) => o.isDefault))?.resetUrl ?? '');
    }, [isOpen, options.data, vertical]);

    const create = useMutation({
        mutationFn: async (v: { userId: string; resetUrl: string }) =>
            (await adminApi.post(`/admin/tenants/${tenantId}/users/${v.userId}/password-reset/link`, v.resetUrl ? { resetUrl: v.resetUrl } : {})).data as IssuedLink,
        onSuccess: (d) => setIssued(d),
        onError: (err) => toast.error(errorMessage(err, 'Could not create a reset link')),
    });

    const copy = (link: string) =>
        navigator.clipboard?.writeText(link)
            .then(() => toast.success('Reset link copied'))
            .catch(() => toast.error('Could not copy. Select the link and copy it by hand.'));

    const list = options.data ?? [];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Copy a password reset link" maxWidth="max-w-lg">
            {person && !issued && (
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!create.isPending) create.mutate({ userId: person.id, resetUrl });
                    }}
                >
                    <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                            <p className="font-medium">Whoever has this link can set {person.name}&rsquo;s password and sign in as them.</p>
                            <p className="text-amber-200/80">It works once, for one hour. Send it only to {person.email} or a number you know is theirs. Creating it is recorded in the audit log.</p>
                        </div>
                    </div>
                    {list.length > 1 && (
                        <div className="space-y-1.5">
                            <label htmlFor="reset-page" className="block text-sm font-medium text-slate-300">Reset page</label>
                            <select
                                id="reset-page"
                                value={resetUrl}
                                onChange={(e) => setResetUrl(e.target.value)}
                                className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                            >
                                {list.map((o) => (
                                    <option key={o.origin} value={o.resetUrl}>{o.isDefault ? 'Bookly dashboard' : o.label}</option>
                                ))}
                            </select>
                            <p className="text-xs text-slate-500">Pick the app this person signs in to.</p>
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
                        <Button type="submit" variant="destructive" isLoading={create.isPending} disabled={options.isLoading}>
                            <KeyRound className="h-4 w-4" /> Create link
                        </Button>
                    </div>
                </form>
            )}

            {person && issued && (
                <div className="space-y-4">
                    <p className="text-sm text-slate-400">
                        Reset link for <span className="text-white">{person.name}</span>. Valid until {formatDateTime(issued.expiresAt)}, once.
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-slate-900/70 px-2 py-1.5 text-xs text-slate-300" title={issued.link}>{issued.link}</code>
                        <Button size="sm" variant="outline" onClick={() => copy(issued.link)}><Copy className="h-4 w-4" /> Copy</Button>
                    </div>
                    <p className="flex items-start gap-2 text-xs text-slate-500">
                        <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Paste it into a WhatsApp chat with {person.name}. Tell them to open it and choose a new password. This dialog is the only place the link is shown; closing it forgets it.
                    </p>
                    <div className="flex justify-end">
                        <Button type="button" variant="outline" onClick={onClose}>Done</Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
