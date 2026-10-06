'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Button, Input } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useAdmin } from '../admin-context';
import { Empty, Panel } from '../_components/parts';
import { errorMessage, formatDateTime } from '../_components/format';

const VERTICALS = ['APPOINTMENTS', 'RIDES'] as const;

interface FlowSummary {
    key: string;
    vertical: string | null;
    activeVersion: number | null;
    versions: Array<{ id: string; version: number; isActive: boolean; createdAt: string; createdBy: string | null }>;
}

export default function AdminFlowsPage() {
    return <Suspense fallback={<div className="flex h-32 items-center justify-center"><BooklyDots size="md" /></div>}><FlowEditor /></Suspense>;
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
            <div>
                <h1 className="text-2xl font-bold text-white">Workflows</h1>
                <p className="text-slate-400">
                    Edit wording, options and prices as JSON. A change is always saved as a <em>new</em> version; nothing is edited in place. Activate a version to publish it, or activate an older one to roll back.
                </p>
            </div>

            <form
                className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/5 p-4 glass-card"
                onSubmit={(e) => { e.preventDefault(); if (ready) { setLoadedScope(scopeQuery); setSelected(null); setText(''); setErrors([]); } }}
            >
                <div className="space-y-1.5">
                    <label htmlFor="scope-mode" className="block text-sm font-medium text-ink-100">Edit</label>
                    <select id="scope-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-3 text-base text-ink-50">
                        <option value="tenant">One organisation&apos;s workflows</option>
                        <option value="vertical">Platform default for a vertical</option>
                    </select>
                </div>
                {mode === 'tenant' ? (
                    <div className="min-w-[16rem]"><Input label="Organisation id" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Copy from the organisation page URL" /></div>
                ) : (
                    <div className="space-y-1.5">
                        <label htmlFor="scope-vertical" className="block text-sm font-medium text-ink-100">Vertical</label>
                        <select id="scope-vertical" value={vertical} onChange={(e) => setVertical(e.target.value as typeof vertical)} className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-3 text-base text-ink-50">
                            {VERTICALS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>
                )}
                <Button type="submit" disabled={!ready}>Load workflows</Button>
            </form>

            {loadedScope && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[22rem_1fr]">
                    <Panel title="Workflows and versions">
                        {flows.isLoading ? <div className="flex h-24 items-center justify-center"><BooklyDots size="md" /></div>
                            : flows.isError ? <p className="px-6 py-6 text-sm text-red-400">{errorMessage(flows.error, 'Could not load workflows.')}</p>
                                : !flows.data?.length ? <Empty>No workflows here yet. Load a platform default, edit it, and save it under this organisation.</Empty> : (
                                    <ul className="divide-y divide-white/5">
                                        {flows.data.map((f) => (
                                            <li key={f.key} className="px-4 py-3">
                                                <p className="text-sm font-medium text-white">{f.key} <span className="text-xs text-slate-500">{f.activeVersion ? `live: v${f.activeVersion}` : 'no live version'}</span></p>
                                                <ul className="mt-2 space-y-1">
                                                    {f.versions.map((v) => {
                                                        const isSel = selected?.key === f.key && selected.version === v.version;
                                                        return (
                                                            <li key={v.id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${isSel ? 'bg-slate-700/60' : 'hover:bg-white/5'}`}>
                                                                <button type="button" className="flex-1 text-left text-sm text-slate-300" onClick={() => loadVersion.mutate({ key: f.key, version: v.version })}>
                                                                    v{v.version} {v.isActive && <Badge variant="default">live</Badge>}
                                                                    <span className="block text-xs text-slate-500">{formatDateTime(v.createdAt)}</span>
                                                                </button>
                                                                {canWrite && !v.isActive && (
                                                                    <Button size="sm" variant="outline" disabled={busy}
                                                                        onClick={() => { if (window.confirm(f.activeVersion && v.version < f.activeVersion ? `Roll back to version ${v.version}? Newer versions stop being live (they are kept).` : `Make version ${v.version} live?`)) activate.mutate({ key: f.key, version: v.version }); }}>
                                                                        {f.activeVersion && v.version < f.activeVersion ? <><RotateCcw className="h-3 w-3" /> Roll back</> : 'Activate'}
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
                                <textarea
                                    aria-label="Workflow definition (JSON)"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    spellCheck={false}
                                    readOnly={!canWrite}
                                    rows={24}
                                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-100 focus:border-emerald-500 focus:outline-none"
                                />
                                {jsonError && <p className="flex items-center gap-2 text-sm text-amber-300"><AlertTriangle className="h-4 w-4" /> Not valid JSON yet: {jsonError}</p>}
                                {errors.length > 0 && (
                                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3" role="alert">
                                        <p className="text-sm font-medium text-rose-300">{errors.length} problem{errors.length === 1 ? '' : 's'} to fix</p>
                                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-200">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                                    </div>
                                )}
                                {validated && errors.length === 0 && <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Valid. Safe to save.</p>}
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" onClick={() => validate.mutate()} isLoading={validate.isPending} disabled={!!jsonError || !text.trim() || busy}>Validate</Button>
                                    {canWrite && <Button onClick={() => save.mutate()} isLoading={save.isPending} disabled={!!jsonError || !flowKey.trim() || busy}>Save as new version</Button>}
                                    {!canWrite && <p className="self-center text-sm text-slate-500">Your role can read and validate workflows but not save them.</p>}
                                </div>
                                <p className="text-xs text-slate-500">A saved version is a draft until you activate it. Tenants keep running the live version until then.</p>
                            </div>
                        )}
                    </Panel>
                </div>
            )}
        </div>
    );
}
