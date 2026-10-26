'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Button, ConfirmDialog, ErrorState, Input, PageHeader, Select, StatusPill, Textarea } from '@bookingflow/ui';
import { useAdmin } from '../admin-context';
import { Empty, LoadingBlock, Panel } from '../_components/parts';
import { errorMessage, formatDateTime } from '../_components/format';

const VERTICALS = ['APPOINTMENTS', 'RIDES'] as const;

interface FlowSummary {
    key: string;
    vertical: string | null;
    activeVersion: number | null;
    versions: Array<{ id: string; version: number; isActive: boolean; createdAt: string; createdBy: string | null }>;
}

export default function AdminFlowsPage() {
    return <Suspense fallback={<LoadingBlock />}><FlowEditor /></Suspense>;
}

function FlowEditor() {
    const { can } = useAdmin();
    const canWrite = can('flows:write');
    const params = useSearchParams();
    const queryClient = useQueryClient();

    // Scope: one tenant's own flows, or the platform default for a vertical.
    const [mode, setMode] = useState<'tenant' | 'vertical'>(params.get('vertical') ? 'vertical' : 'tenant');
    const [tenantId, setTenantId] = useState(params.get('tenantId') ?? '');
    const [vertical, setVertical] = useState<(typeof VERTICALS)[number]>((params.get('vertical') as (typeof VERTICALS)[number]) ?? 'RIDES');
    const [loadedScope, setLoadedScope] = useState<string | null>(params.get('tenantId') ? `tenantId=${params.get('tenantId')}` : null);

    const scopeQuery = mode === 'tenant' ? `tenantId=${encodeURIComponent(tenantId.trim())}` : `vertical=${vertical}`;
    const scopeBody = mode === 'tenant' ? { tenantId: tenantId.trim() } : { vertical };

    const flows = useQuery({
        queryKey: ['admin', 'flows', loadedScope],
        queryFn: async () => (await adminApi.get(`/admin/flows?${loadedScope}`)).data.data as FlowSummary[],
        enabled: !!loadedScope,
    });

    const [selected, setSelected] = useState<{ key: string; version: number } | null>(null);
    const [text, setText] = useState('');
    const [flowKey, setFlowKey] = useState('');
    const [errors, setErrors] = useState<string[]>([]);
    const [validated, setValidated] = useState(false);
    // Activation (publish or roll back) is confirmed in a dialog first.
    const [confirmActivate, setConfirmActivate] = useState<{ key: string; version: number; rollback: boolean } | null>(null);

    const jsonError = useMemo(() => {
        if (!text.trim()) return null;
        try { JSON.parse(text); return null; } catch (e) { return (e as Error).message; }
    }, [text]);

    const loadVersion = useMutation({
        mutationFn: async (v: { key: string; version: number }) =>
            (await adminApi.get(`/admin/flows/${v.key}/versions/${v.version}?${loadedScope}`)).data,
        onSuccess: (d, v) => {
            setSelected(v);
            setFlowKey(v.key);
            setText(JSON.stringify(d.definition, null, 2));
            setErrors([]);
            setValidated(false);
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not load that version')),
    });

    const parsed = () => { try { return JSON.parse(text); } catch { return null; } };

    const validate = useMutation({
        mutationFn: async () => (await adminApi.post('/admin/flows/validate', { definition: parsed(), key: flowKey || undefined })).data as { ok: boolean; errors: string[] },
        onSuccess: (r) => { setErrors(r.errors); setValidated(r.ok); if (r.ok) toast.success('This workflow is valid'); },
        onError: (err) => toast.error(errorMessage(err, 'Could not validate')),
    });

    const save = useMutation({
        mutationFn: async () => (await adminApi.post(`/admin/flows/${flowKey}/versions`, { ...scopeBody, definition: parsed() })).data,
        onSuccess: (d) => {
            toast.success(`Saved as version ${d.version} (not live yet)`);
            setErrors([]);
            queryClient.invalidateQueries({ queryKey: ['admin', 'flows'] });
            setSelected({ key: d.key, version: d.version });
        },
        onError: (err: any) => {
            // 422 carries the validation errors; show them next to the editor.
            const list = err?.response?.data?.errors;
            if (Array.isArray(list)) setErrors(list);
            toast.error(errorMessage(err, 'Could not save'));
        },
    });

    const activate = useMutation({
        mutationFn: async (v: { key: string; version: number }) =>
            (await adminApi.post(`/admin/flows/${v.key}/activate`, { ...scopeBody, version: v.version })).data as { rollback: boolean; activeVersion: number },
        onSuccess: (d, v) => {
            toast.success(d.rollback ? `Rolled back to version ${v.version}` : `Version ${v.version} is live`);
            setConfirmActivate(null);
            queryClient.invalidateQueries({ queryKey: ['admin', 'flows'] });
        },
        onError: (err: any) => {
            const list = err?.response?.data?.errors;
            if (Array.isArray(list)) setErrors(list);
            toast.error(errorMessage(err, 'Could not activate'));
        },
    });

    // Editing invalidates the last validation result.
    useEffect(() => { setValidated(false); }, [text]);

    const ready = mode === 'vertical' || tenantId.trim().length > 0;
    const busy = save.isPending || activate.isPending || validate.isPending;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Workflows"
                subtitle="Edit wording, options and prices as JSON. Every change is saved as a new version, never edited in place. Activate a version to publish it, or activate an older one to roll back."
            />

            <form
                className="grid grid-cols-1 items-end gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-5"
                onSubmit={(e) => { e.preventDefault(); if (ready) { setLoadedScope(scopeQuery); setSelected(null); setText(''); setErrors([]); } }}
            >
                <Select id="scope-mode" label="Edit" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                    <option value="tenant">One business&apos;s workflows</option>
                    <option value="vertical">Platform default for a vertical</option>
                </Select>
                {mode === 'tenant' ? (
                    <Input label="Business id" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Copy it from the business page address" />
                ) : (
                    <Select id="scope-vertical" label="Vertical" value={vertical} onChange={(e) => setVertical(e.target.value as typeof vertical)}>
                        {VERTICALS.map((v) => <option key={v} value={v}>{v}</option>)}
                    </Select>
                )}
                <Button type="submit" disabled={!ready}>Load workflows</Button>
            </form>

            {loadedScope && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[22rem_1fr]">
                    <Panel title="Workflows and versions">
                        {flows.isLoading ? <LoadingBlock />
                            : flows.isError ? (
                                <ErrorState
                                    title="We couldn't load the workflows"
                                    description={errorMessage(flows.error, 'Check the business id and try again.')}
                                    onRetry={() => flows.refetch()}
                                    isRetrying={flows.isRefetching}
                                />
                            )
                                : !flows.data?.length ? <Empty>No workflows here yet. Load a platform default, edit it, and save it under this business.</Empty> : (
                                    <ul className="divide-y divide-border">
                                        {flows.data.map((f) => (
                                            <li key={f.key} className="px-4 py-3">
                                                <p className="text-[15px] font-semibold text-text">{f.key} <span className="text-[13px] font-normal text-muted">{f.activeVersion ? `live: v${f.activeVersion}` : 'no live version'}</span></p>
                                                <ul className="mt-2 space-y-1">
                                                    {f.versions.map((v) => {
                                                        const isSel = selected?.key === f.key && selected.version === v.version;
                                                        return (
                                                            <li key={v.id} className={`flex items-center justify-between gap-2 rounded-control px-2 py-1.5 ${isSel ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
                                                                <button type="button" aria-current={isSel ? 'true' : undefined} className="min-h-[44px] flex-1 rounded-control text-left text-[15px] text-text" onClick={() => loadVersion.mutate({ key: f.key, version: v.version })}>
                                                                    v{v.version} {v.isActive && <StatusPill size="sm" status="live" tone="success" />}
                                                                    <span className="block text-[13px] text-muted">{formatDateTime(v.createdAt)}</span>
                                                                </button>
                                                                {canWrite && !v.isActive && (
                                                                    <Button size="sm" variant="secondary" disabled={busy}
                                                                        onClick={() => setConfirmActivate({ key: f.key, version: v.version, rollback: !!(f.activeVersion && v.version < f.activeVersion) })}>
                                                                        {f.activeVersion && v.version < f.activeVersion ? <><RotateCcw className="h-4 w-4" aria-hidden /> Roll back</> : 'Activate'}
                                                                    </Button>
                                                                )}
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                    </Panel>

                    <Panel title={selected ? `Editing ${selected.key} (from v${selected.version}) — saves as a new version` : 'Editor'}>
                        {!text && !loadVersion.isPending ? <Empty>Pick a version on the left to load it here.</Empty> : (
                            <div className="space-y-3 p-4">
                                <Input label="Workflow key" value={flowKey} onChange={(e) => setFlowKey(e.target.value)} disabled={!canWrite} />
                                <Textarea
                                    aria-label="Workflow definition (JSON)"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    spellCheck={false}
                                    readOnly={!canWrite}
                                    rows={24}
                                    className="font-mono text-[13px]"
                                />
                                {jsonError && <p className="flex items-start gap-2 text-[14px] text-warning-fg"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Not valid JSON yet: {jsonError}</p>}
                                {errors.length > 0 && (
                                    <div className="rounded-card border border-error/40 bg-error-soft p-3" role="alert">
                                        <p className="text-[14px] font-medium text-error-fg">{errors.length} problem{errors.length === 1 ? '' : 's'} to fix</p>
                                        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-error-fg">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                                    </div>
                                )}
                                {validated && errors.length === 0 && <p className="flex items-center gap-2 text-[14px] font-medium text-success-fg"><CheckCircle2 className="h-4 w-4" aria-hidden /> Valid. Safe to save.</p>}
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="secondary" onClick={() => validate.mutate()} isLoading={validate.isPending} disabled={!!jsonError || !text.trim() || busy}>Validate</Button>
                                    {canWrite && <Button onClick={() => save.mutate()} isLoading={save.isPending} disabled={!!jsonError || !flowKey.trim() || busy}>Save as new version</Button>}
                                    {!canWrite && <p className="self-center text-[14px] text-muted">Your role can read and validate workflows but not save them.</p>}
                                </div>
                                <p className="text-[14px] text-muted">A saved version is a draft until you activate it. Businesses keep running the live version until then.</p>
                            </div>
                        )}
                    </Panel>
                </div>
            )}

            <ConfirmDialog
                isOpen={confirmActivate !== null}
                onClose={() => setConfirmActivate(null)}
                onConfirm={() => confirmActivate && activate.mutate({ key: confirmActivate.key, version: confirmActivate.version })}
                title={confirmActivate?.rollback ? `Roll back to version ${confirmActivate.version}?` : `Make version ${confirmActivate?.version ?? ''} live?`}
                description={confirmActivate?.rollback ? 'Newer versions stop being live, but they are kept.' : 'Customers start seeing this version straight away.'}
                confirmLabel={confirmActivate?.rollback ? 'Roll back' : 'Make it live'}
                cancelLabel="Not now"
                destructive={!!confirmActivate?.rollback}
                isLoading={activate.isPending}
            />
        </div>
    );
}
