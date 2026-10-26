'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Copy, KeyRound, Mail, Smartphone } from 'lucide-react';
import { Button, Modal, Select, StatusPill } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Empty, Panel, THead, Table, Td, Th, Tr } from '../../_components/parts';
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
        onError: (err) => toast.error(errorMessage(err, "Couldn't send the reset email. Let's try again.")),
    });

    return (
        <Panel title={`People (${people.length})`}>
            {!people.length ? <Empty>No one has been added to this business yet.</Empty> : (
                <Table>
                    <THead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th /></tr></THead>
                    <tbody>
                        {people.map((u) => {
                            const canRecover = tenantActive && u.isActive;
                            return (
                                <Tr key={u.id}>
                                    <Td><span className="font-semibold">{u.name}</span></Td>
                                    <Td label="Email" className="break-all">{u.email}</Td>
                                    <Td label="Role">{u.role}</Td>
                                    <Td label="Status"><StatusPill size="sm" status={u.isActive ? 'active' : 'inactive'} tone={u.isActive ? 'success' : 'error'} /></Td>
                                    <Td>
                                        {canRecover && (mayEmail || mayLink) && (
                                            <div className="flex flex-wrap gap-2 md:justify-end">
                                                {mayEmail && (
                                                    <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'email', person: u })}>
                                                        <Mail className="h-4 w-4" aria-hidden /> Send reset email
                                                    </Button>
                                                )}
                                                {mayLink && (
                                                    <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'link', person: u })}>
                                                        <KeyRound className="h-4 w-4" aria-hidden /> Copy reset link
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </Td>
                                </Tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}

            <Modal isOpen={pending?.kind === 'email'} onClose={() => setPending(null)} title="Send a password reset email">
                {pending?.kind === 'email' && (
                    <div className="space-y-4">
                        <p className="text-[15px] text-muted">
                            Bookly will email <span className="font-medium text-text">{pending.person.email}</span> the standard reset link. It works once, for one hour, and opens the Bookly reset page. You won&apos;t see the link or the new password.
                        </p>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <Button type="button" variant="secondary" onClick={() => setPending(null)} disabled={sendEmail.isPending}>Cancel</Button>
                            <Button type="button" onClick={() => sendEmail.mutate(pending.person)} isLoading={sendEmail.isPending}>
                                <Mail className="h-4 w-4" aria-hidden /> Send email
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
        onError: (err) => toast.error(errorMessage(err, "Couldn't create a reset link. Let's try again.")),
    });

    const copy = (link: string) =>
        navigator.clipboard?.writeText(link)
            .then(() => toast.success('Reset link copied'))
            .catch(() => toast.error("Couldn't copy. Select the link and copy it by hand."));

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
                    <div className="flex gap-2 rounded-card border border-warning/40 bg-warning-soft p-3 text-[14px] text-warning-fg">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <div className="space-y-1">
                            <p className="font-semibold">Whoever has this link can set {person.name}&rsquo;s password and sign in as them.</p>
                            <p>It works once, for one hour. Send it only to {person.email} or a number you know is theirs. Creating it is recorded in the audit log.</p>
                        </div>
                    </div>
                    {list.length > 1 && (
                        <Select
                            id="reset-page"
                            label="Reset page"
                            value={resetUrl}
                            onChange={(e) => setResetUrl(e.target.value)}
                            hint="Pick the app this person signs in to."
                        >
                            {list.map((o) => (
                                <option key={o.origin} value={o.resetUrl}>{o.isDefault ? 'Bookly dashboard' : o.label}</option>
                            ))}
                        </Select>
                    )}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
                        <Button type="submit" variant="destructive" isLoading={create.isPending} disabled={options.isLoading}>
                            <KeyRound className="h-4 w-4" aria-hidden /> Create link
                        </Button>
                    </div>
                </form>
            )}

            {person && issued && (
                <div className="space-y-4">
                    <p className="text-[15px] text-muted">
                        Reset link for <span className="font-medium text-text">{person.name}</span>. Works once, until {formatDateTime(issued.expiresAt)}.
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-control bg-surface-2 px-3 py-2 text-[13px] text-text" title={issued.link}>{issued.link}</code>
                        <Button size="sm" variant="secondary" onClick={() => copy(issued.link)}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
                    </div>
                    <p className="flex items-start gap-2 text-[14px] text-muted">
                        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        Paste it into a WhatsApp chat with {person.name}. Tell them to open it and choose a new password. This dialog is the only place the link is shown; closing it forgets it.
                    </p>
                    <div className="flex justify-end">
                        <Button type="button" variant="secondary" onClick={onClose}>Done</Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
