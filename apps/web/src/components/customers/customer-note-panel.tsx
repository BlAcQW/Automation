'use client';

/**
 * The staff note on a customer, reached through one of their chats (the inbox
 * and the customers page both have a conversation id; not every chat has a
 * customer record yet, and saving creates one for a verified WhatsApp number).
 *
 * A chat without a verified number (a WhatsApp username, Instagram, Messenger)
 * gets a plain explanation instead of a box: the only number it has was typed
 * by the customer, so a note could land on someone else.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, ShieldCheck } from 'lucide-react';
import { Button, ErrorState, Skeleton, Textarea } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { CharCount } from '@/components/assistant/knowledge-inputs';
import { SaveRow, useSavedFlash } from '@/app/settings/_components/settings-card';

export const NOTE_MAX = 1000;

interface NoteResponse {
    eligible: boolean;
    reason?: 'username_only' | 'unverified_channel' | 'no_phone';
    customerId: string | null;
    note: string;
    updatedAt: string | null;
    updatedBy: { name: string } | null;
}

/** One root per entity (SHARED-12): every view of a chat's note shares it. */
export const customerNoteKeys = {
    all: ['customer-note'] as const,
    byConversation: (conversationId: string) => ['customer-note', conversationId] as const,
};

const WHY_NOT: Record<NonNullable<NoteResponse['reason']>, string> = {
    username_only:
        "This customer chats with a WhatsApp username and keeps their number hidden, so we can't be sure who they are. Notes can only be kept for customers with a verified WhatsApp number.",
    unverified_channel:
        "Instagram and Messenger don't share a verified phone number, so notes can't be kept for this chat. If this customer messages you on WhatsApp, you can add a note there.",
    no_phone: "This chat has no verified WhatsApp number yet, so a note can't be kept for it.",
};

function updatedLine(n: NoteResponse): string | null {
    if (!n.updatedAt) return null;
    const when = new Date(n.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Updated ${when}${n.updatedBy ? ` by ${n.updatedBy.name}` : ''}.`;
}

export function CustomerNotePanel({ conversationId }: { conversationId: string }) {
    const queryClient = useQueryClient();
    const key = customerNoteKeys.byConversation(conversationId);
    const { data, isLoading, isError, refetch, isRefetching } = useQuery<NoteResponse>({
        queryKey: key,
        queryFn: async () => (await api.get(`/customers/by-conversation/${conversationId}/note`)).data,
        refetchOnWindowFocus: false,
    });

    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, flashSaved] = useSavedFlash();

    useEffect(() => {
        if (data) setDraft(data.note);
    }, [data]);

    if (isLoading) {
        return (
            <div aria-busy="true" className="space-y-2">
                <span className="sr-only">Loading…</span>
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-28 w-full rounded-control" />
            </div>
        );
    }
    if (isError || !data) return <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />;

    if (!data.eligible) {
        return (
            <div className="flex items-start gap-3 rounded-control bg-surface-2 p-4">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
                <div>
                    <p className="text-base font-semibold text-text">Notes aren&rsquo;t available for this chat</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted">{WHY_NOT[data.reason ?? 'no_phone']}</p>
                </div>
            </div>
        );
    }

    const dirty = draft.trim() !== data.note.trim();

    const save = async () => {
        setSaving(true);
        try {
            const res = await api.put(`/customers/by-conversation/${conversationId}/note`, { note: draft });
            queryClient.setQueryData(key, res.data);
            notify.success(draft.trim() ? 'Note saved' : 'Note cleared');
            flashSaved();
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't save the note. Check your connection and try again.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <Textarea
                    id={`note-${conversationId}`}
                    label="Notes about this customer"
                    rows={5}
                    value={draft}
                    maxLength={NOTE_MAX}
                    placeholder="Prefers Ama for facials. Sensitive skin: patch test first. Likes early morning slots."
                    onChange={(e) => setDraft(e.target.value)}
                />
                <CharCount value={draft} limit={NOTE_MAX} />
            </div>
            <p className="flex items-start gap-2 text-[14px] leading-snug text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                Only your team and your assistant see this. Don&rsquo;t store more than you need, e.g. no medical records.
            </p>
            <SaveRow saved={saved} label="Saved">
                <Button onClick={save} isLoading={saving} loadingText="Saving…" disabled={!dirty}>
                    Save note
                </Button>
            </SaveRow>
            {updatedLine(data) && <p className="text-[14px] text-muted">{updatedLine(data)}</p>}
        </div>
    );
}
