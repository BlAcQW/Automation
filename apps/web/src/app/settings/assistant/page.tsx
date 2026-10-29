'use client';

/**
 * Settings > Your assistant: what the assistant should know about the business
 * (its knowledge base), plus a panel to try it out.
 *
 * Owners edit; staff can read and try it. Saving replaces the whole set (PUT).
 * Unsaved edits are guarded (tab close and in-app links) and are what the
 * "Try your assistant" panel uses, so an answer can be checked before saving.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import {
    Button, Card, CardContent, ConfirmDialog, ErrorState, PageHeader, SectionHeading, SkeletonCard,
} from '@bookingflow/ui';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { SaveRow, useSavedFlash } from '../_components/settings-card';
import { Completeness } from '@/components/assistant/completeness';
import { KnowledgeForm } from '@/components/assistant/knowledge-form';
import { TryAssistantPanel } from '@/components/assistant/try-assistant-panel';
import { useUnsavedChanges } from '@/components/assistant/use-unsaved-changes';
import {
    EMPTY_KNOWLEDGE, completeness, snapshot, toForm, toPayload, validate, withoutBlankRows,
    type BusinessType, type Knowledge, type KnowledgeForm as KnowledgeFormState,
} from '@/components/assistant/knowledge-fields';

interface KnowledgeResponse {
    knowledge: Knowledge;
    updatedAt: string | null;
    updatedBy: { name: string } | null;
    canEdit: boolean;
}

const QUERY_KEY = ['assistant-knowledge'] as const;

/** API 400 `fields` -> { "faqs.2.answer": "..." }. */
function fieldErrors(err: any): Record<string, string> {
    const fields: Array<{ field: string; message: string }> = err?.response?.data?.fields ?? [];
    return Object.fromEntries(fields.map((f) => [f.field === '(body)' ? '_total' : f.field, f.message]));
}

function savedLine(data: KnowledgeResponse | undefined): string | null {
    if (!data?.updatedAt) return null;
    const when = new Date(data.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `Last saved ${when}${data.updatedBy ? ` by ${data.updatedBy.name}` : ''}.`;
}

export default function AssistantSettingsPage() {
    const { tenant, user } = useAuth();
    const queryClient = useQueryClient();
    const businessType: BusinessType = tenant?.businessType ?? 'SERVICE';

    const { data, isLoading, isError, refetch, isRefetching } = useQuery<KnowledgeResponse>({
        queryKey: QUERY_KEY,
        queryFn: async () => (await api.get('/assistant/knowledge')).data,
        // The form holds the working copy; a background refetch must not wipe edits.
        refetchOnWindowFocus: false,
    });

    const [form, setForm] = useState<KnowledgeFormState>(() => toForm(EMPTY_KNOWLEDGE));
    const [baseline, setBaseline] = useState(() => snapshot(toForm(EMPTY_KNOWLEDGE)));
    const [loaded, setLoaded] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [saved, flashSaved] = useSavedFlash();

    useEffect(() => {
        if (!data || loaded) return;
        const initial = toForm(data.knowledge);
        setForm(initial);
        setBaseline(snapshot(initial));
        setLoaded(true);
    }, [data, loaded]);

    const canEdit = !!data?.canEdit && user?.role === 'OWNER';
    const dirty = loaded && canEdit && snapshot(form) !== baseline;
    const guard = useUnsavedChanges(dirty);
    const progress = useMemo(() => completeness(form), [form]);

    const onChange = (next: KnowledgeFormState) => {
        setForm(next);
        if (Object.keys(errors).length) setErrors({});
    };

    const save = async () => {
        const cleaned = withoutBlankRows(form);
        const problems = validate(cleaned);
        if (Object.keys(problems).length) {
            setErrors(problems);
            notify.error(problems._total ?? 'A few answers need fixing. Check the fields marked in red.');
            return;
        }
        setSaving(true);
        try {
            const res = await api.put('/assistant/knowledge', toPayload(cleaned));
            const next = toForm((res.data as KnowledgeResponse).knowledge);
            setForm(next);
            setBaseline(snapshot(next));
            setErrors({});
            queryClient.setQueryData(QUERY_KEY, res.data);
            notify.success('Saved. Your assistant knows this now.');
            flashSaved();
        } catch (err: any) {
            const fields = fieldErrors(err);
            setErrors(fields);
            notify.error(
                err?.response?.status === 403
                    ? 'Only the account owner can change this.'
                    : Object.keys(fields).length
                        ? 'A few answers need fixing. Check the fields marked in red.'
                        : "Couldn't save. Check your connection and try again.",
            );
        } finally {
            setSaving(false);
        }
    };

    const header = (
        <PageHeader
            eyebrow={
                <Link href="/settings" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control text-muted hover:text-text">
                    <ArrowLeft className="h-4 w-4" aria-hidden /> Settings
                </Link>
            }
            title="Your assistant"
            subtitle="Tell your assistant about your business, so it can answer customers the way you would instead of passing every question to you."
        />
    );

    if (isError) {
        return (
            <div className="mx-auto max-w-6xl space-y-6">
                {header}
                <Card><ErrorState onRetry={() => refetch()} isRetrying={isRefetching} /></Card>
            </div>
        );
    }

    if (isLoading || !loaded) {
        return (
            <div className="mx-auto max-w-6xl space-y-6">
                {header}
                <div aria-busy="true" className="space-y-4">
                    <span className="sr-only">Loading…</span>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            {header}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
                <div className="min-w-0 space-y-5">
                    {!canEdit && (
                        <Card>
                            <CardContent className="flex items-start gap-3">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-muted" aria-hidden>
                                    <Lock className="h-5 w-5" />
                                </span>
                                <div>
                                    <p className="text-base font-semibold text-text">Only the account owner can change this</p>
                                    <p className="mt-1 text-[15px] leading-relaxed text-muted">
                                        You can read it and try your assistant. Ask the owner if something here is out of date.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Completeness {...progress} businessType={businessType} />

                    <SectionHeading
                        title="What your assistant should know"
                        description="Fill in what applies to you. Leave the rest empty: your assistant only uses what's here, and checks with your team about anything else."
                    />

                    <KnowledgeForm form={form} onChange={onChange} errors={errors} businessType={businessType} readOnly={!canEdit} />

                    {errors._total && <p role="alert" className="text-[15px] font-medium text-error-fg">{errors._total}</p>}

                    {canEdit && (
                        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 lg:bottom-4">
                            <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-card-lg">
                                <p className="min-w-0 text-[15px] text-muted" aria-live="polite">
                                    {dirty ? <span className="font-semibold text-text">You have unsaved changes.</span> : savedLine(data) ?? 'Nothing saved yet.'}
                                </p>
                                <SaveRow saved={saved}>
                                    <Button onClick={save} isLoading={saving} loadingText="Saving…" disabled={!dirty}>
                                        Save changes
                                    </Button>
                                </SaveRow>
                            </Card>
                        </div>
                    )}
                </div>

                <aside className="min-w-0 lg:sticky lg:top-6" aria-label="Try your assistant">
                    <TryAssistantPanel businessType={businessType} unsavedKnowledge={dirty ? toPayload(withoutBlankRows(form)) : null} />
                </aside>
            </div>

            <ConfirmDialog
                isOpen={guard.pendingHref !== null}
                onClose={guard.stay}
                onConfirm={guard.leave}
                title="Leave without saving?"
                description="Your changes on this page haven't been saved yet."
                confirmLabel="Leave without saving"
                cancelLabel="Stay and save"
                destructive
            />
        </div>
    );
}
