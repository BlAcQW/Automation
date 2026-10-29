'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Copy, Link2, MessageCircle, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button, ConfirmDialog, Drawer, Select, StatusPill, Textarea, formatGhanaPhone } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { BUSINESS_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, WAITLIST_STATUSES, type WaitlistStatus } from '@/lib/waitlist';
import { errorMessage, formatDate, formatDateTime } from '../_components/format';
import type { InviteResult, WaitlistEntry } from './types';

const INVITE_STATE_LABEL: Record<NonNullable<WaitlistEntry['inviteState']>, string> = {
    valid: 'Link works',
    expired: 'Link expired',
    used: 'Link used',
    invalid: 'Link no longer works',
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid gap-0.5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-[13px] font-medium text-muted">{label}</dt>
            <dd className="min-w-0 break-words text-[15px] text-text">{children}</dd>
        </div>
    );
}

const waLink = (phone: string, text?: string) =>
    `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/**
 * Everything about one waitlist entry, and what an admin can do with it:
 * status, notes, a one-time invite link (copy it, WhatsApp it, or email it)
 * and delete. Write actions only show for roles with waitlist:write.
 */
export function WaitlistDrawer({
    entry, canWrite, onClose, onChanged, onDeleted,
}: {
    entry: WaitlistEntry | null;
    canWrite: boolean;
    onClose: () => void;
    onChanged: (entry: WaitlistEntry) => void;
    onDeleted: (id: string) => void;
}) {
    const [notes, setNotes] = useState('');
    const [emailInvite, setEmailInvite] = useState(true);
    const [invite, setInvite] = useState<InviteResult | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const linkRef = useRef<HTMLInputElement>(null);
    const entryId = entry?.id;

    useEffect(() => {
        setNotes(entry?.adminNotes ?? '');
        setInvite(null);
        setConfirmDelete(false);
        // Only when a different entry opens: keep typed notes across a status change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entryId]);

    const update = useMutation({
        mutationFn: async (body: { status?: WaitlistStatus; adminNotes?: string | null }) =>
            (await adminApi.patch(`/admin/waitlist/${entryId}`, body)).data.data as WaitlistEntry,
        onSuccess: (updated, body) => {
            onChanged(updated);
            toast.success(body.status ? `Marked as ${STATUS_LABEL[body.status].toLowerCase()}` : 'Notes saved');
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't save that. Let's try again.")),
    });

    const makeInvite = useMutation({
        mutationFn: async () =>
            (await adminApi.post(`/admin/waitlist/${entryId}/invite`, { sendEmail: emailInvite })).data.data as InviteResult,
        onSuccess: (result) => {
            setInvite(result);
            onChanged(result.entry);
            if (result.emailed) toast.success(`Invite emailed to ${result.entry.email}`);
            else if (result.emailError === 'email_not_configured') toast.error('Email is not set up on the server. Copy the link and send it yourself.');
            else if (result.emailError === 'send_failed') toast.error("The email didn't send. Copy the link and send it yourself.");
            else toast.success('Invite link ready');
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't make the invite. Let's try again.")),
    });

    const remove = useMutation({
        mutationFn: async () => (await adminApi.delete(`/admin/waitlist/${entryId}`)).data,
        onSuccess: () => {
            setConfirmDelete(false);
            toast.success('Removed from the waitlist');
            if (entryId) onDeleted(entryId);
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't remove them. Let's try again.")),
    });

    const copyLink = async () => {
        if (!invite) return;
        try {
            await navigator.clipboard.writeText(invite.link);
            toast.success('Link copied');
        } catch {
            linkRef.current?.select();
            toast('Select the link and copy it.');
        }
    };

    if (!entry) return <Drawer isOpen={false} onClose={onClose} title="">{null}</Drawer>;

    const first = entry.name.trim().split(/\s+/)[0];
    const joined = entry.status === 'JOINED';

    return (
        <>
            <Drawer isOpen onClose={onClose} title={entry.businessName}>
                <div className="space-y-6">
                    <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={entry.status} tone={STATUS_TONE[entry.status]} label={STATUS_LABEL[entry.status]} />
                        <span className="text-[14px] text-muted">Joined the list {formatDate(entry.createdAt)}</span>
                    </div>

                    <dl className="divide-y divide-border">
                        <Detail label="Name">{entry.name}</Detail>
                        <Detail label="Business type">{BUSINESS_TYPE_LABEL[entry.businessType] ?? entry.businessType}</Detail>
                        <Detail label="WhatsApp">
                            <a href={waLink(entry.phone)} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                                {formatGhanaPhone(entry.phone)}
                            </a>
                        </Detail>
                        <Detail label="Email">
                            <a href={`mailto:${entry.email}`} className="break-all font-medium text-primary underline-offset-4 hover:underline">{entry.email}</a>
                        </Detail>
                        <Detail label="Town or area">{entry.city}</Detail>
                        <Detail label="Heard from">{entry.heardFrom ?? '—'}</Detail>
                        <Detail label="Their note">{entry.message ? <span className="whitespace-pre-wrap">{entry.message}</span> : '—'}</Detail>
                        <Detail label="Agreed to contact">{formatDateTime(entry.consentAt)}</Detail>
                        {entry.invitedAt && (
                            <Detail label="Invite">
                                Sent {formatDateTime(entry.invitedAt)}
                                {entry.inviteState && <> · {INVITE_STATE_LABEL[entry.inviteState]}</>}
                                {entry.inviteExpiresAt && entry.inviteState === 'valid' && <> until {formatDate(entry.inviteExpiresAt)}</>}
                            </Detail>
                        )}
                        {entry.joinedTenantId && (
                            <Detail label="Their business">
                                <Link href={`/admin/tenants/${entry.joinedTenantId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                                    Open in Businesses
                                </Link>
                            </Detail>
                        )}
                    </dl>

                    {canWrite && (
                        <>
                            <Select
                                id="wl-drawer-status"
                                label="Status"
                                value={entry.status}
                                disabled={update.isPending}
                                onChange={(e) => update.mutate({ status: e.target.value as WaitlistStatus })}
                                hint={entry.status === 'INVITED' ? 'An invite link only works while the status is Invited.' : undefined}
                            >
                                {WAITLIST_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                            </Select>

                            <form
                                className="space-y-3"
                                onSubmit={(e) => { e.preventDefault(); update.mutate({ adminNotes: notes.trim() || null }); }}
                            >
                                <Textarea
                                    id="wl-drawer-notes"
                                    label="Notes (only admins see these)"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    maxLength={2000}
                                    rows={3}
                                    placeholder="Called on Monday, wants a demo with her two staff…"
                                />
                                <Button type="submit" variant="secondary" size="sm" isLoading={update.isPending && !update.variables?.status} disabled={notes === (entry.adminNotes ?? '')}>
                                    Save notes
                                </Button>
                            </form>

                            <section aria-labelledby="wl-invite-title" className="rounded-card border border-border bg-surface-2 p-4">
                                <h3 id="wl-invite-title" className="text-[16px] font-bold text-text">Invite to sign up</h3>
                                {joined ? (
                                    <p className="mt-1 text-[15px] text-muted">They have joined Bookly. Nothing more to send.</p>
                                ) : invite ? (
                                    <div className="mt-3 space-y-3">
                                        <label htmlFor="wl-invite-link" className="block text-[14px] font-semibold text-text">Their sign-up link</label>
                                        <input
                                            id="wl-invite-link"
                                            ref={linkRef}
                                            readOnly
                                            value={invite.link}
                                            onFocus={(e) => e.currentTarget.select()}
                                            className="w-full min-h-[44px] rounded-control border border-border bg-surface px-3 text-[14px] text-text"
                                        />
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <Button type="button" size="sm" onClick={copyLink}><Copy className="h-4 w-4" aria-hidden /> Copy link</Button>
                                            <a
                                                href={waLink(entry.phone, `Hi ${first}, it's your turn on Bookly! Create your account for ${entry.businessName} here: ${invite.link}`)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-text hover:bg-surface-2"
                                            >
                                                <MessageCircle className="h-4 w-4" aria-hidden /> Send on WhatsApp
                                            </a>
                                        </div>
                                        <p className="text-[14px] text-muted">
                                            Shown once: we only keep a fingerprint of it. It works until {formatDate(invite.expiresAt)} and only for {entry.email}.
                                            {invite.emailed && ' We emailed it to them too.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="mt-2 space-y-3">
                                        <p className="text-[15px] text-muted">
                                            {entry.invitedAt
                                                ? 'Making a new link stops the old one working.'
                                                : 'A one-time link to create their account, for their email only. It works for 14 days.'}
                                        </p>
                                        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px] text-text">
                                            <input
                                                type="checkbox"
                                                checked={emailInvite}
                                                onChange={(e) => setEmailInvite(e.target.checked)}
                                                className="h-5 w-5 shrink-0 rounded-[4px] border-border accent-primary"
                                            />
                                            Also email it to {entry.email}
                                        </label>
                                        <Button type="button" onClick={() => makeInvite.mutate()} isLoading={makeInvite.isPending} loadingText="Making the link…">
                                            <Link2 className="h-4 w-4" aria-hidden /> {entry.invitedAt ? 'Make a new invite link' : 'Invite'}
                                        </Button>
                                    </div>
                                )}
                            </section>

                            <div className="border-t border-border pt-4">
                                <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                                    <Trash2 className="h-4 w-4" aria-hidden /> Remove from the waitlist
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </Drawer>

            <ConfirmDialog
                isOpen={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                onConfirm={() => remove.mutate()}
                title={`Remove ${entry.businessName} from the waitlist?`}
                description="Their details are deleted for good. If they join again, they go back to the end of the list."
                confirmLabel="Remove"
                destructive
                isLoading={remove.isPending}
            />
        </>
    );
}
