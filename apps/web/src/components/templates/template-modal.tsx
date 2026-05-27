'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';

// Mirrors apps/api/prisma/schema.prisma — keep in sync if the enum grows.
export type TemplatePurpose =
    | 'BOOKING_CONFIRMATION'
    | 'BOOKING_REMINDER'
    | 'BOOKING_CANCELLED'
    | 'BOOKING_RESCHEDULED'
    | 'ORDER_CONFIRMATION'
    | 'ORDER_SHIPPED'
    | 'ORDER_DELIVERED';

export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

// Source of truth for variable order also lives in the Prisma schema comment.
// Tenants designing Meta-side templates MUST place {{1}}, {{2}}, ... in this
// order or the wrong values land in the wrong placeholders.
export const TEMPLATE_VARIABLE_ORDER: Record<TemplatePurpose, string[]> = {
    BOOKING_CONFIRMATION: ['customerName', 'serviceName', 'date', 'time', 'bookingRef'],
    BOOKING_REMINDER: ['serviceName', 'time'],
    BOOKING_CANCELLED: ['serviceName', 'date'],
    BOOKING_RESCHEDULED: ['serviceName', 'newDate', 'newTime'],
    ORDER_CONFIRMATION: ['orderRef', 'total'],
    ORDER_SHIPPED: ['orderRef'],
    ORDER_DELIVERED: ['orderRef'],
};

export interface TemplateRow {
    id: string;
    tenantId: string;
    name: string;
    language: string;
    purpose: TemplatePurpose;
    category: TemplateCategory;
    bodyPreview: string | null;
    variableCount: number;
    isApproved: boolean;
    createdAt: string;
    updatedAt: string;
}

const PURPOSES: TemplatePurpose[] = [
    'BOOKING_CONFIRMATION',
    'BOOKING_REMINDER',
    'BOOKING_CANCELLED',
    'BOOKING_RESCHEDULED',
    'ORDER_CONFIRMATION',
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
];

const CATEGORIES: TemplateCategory[] = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];

interface TemplateModalProps {
    isOpen: boolean;
    onClose: () => void;
    existing: TemplateRow | null;
    onSaved: () => void | Promise<void>;
}

interface FormState {
    name: string;
    language: string;
    purpose: TemplatePurpose;
    category: TemplateCategory;
    variableCount: number;
    bodyPreview: string;
    isApproved: boolean;
}

const defaultForm: FormState = {
    name: '',
    language: 'en_US',
    purpose: 'BOOKING_CONFIRMATION',
    category: 'UTILITY',
    variableCount: TEMPLATE_VARIABLE_ORDER.BOOKING_CONFIRMATION.length,
    bodyPreview: '',
    isApproved: false,
};

export function TemplateModal({ isOpen, onClose, existing, onSaved }: TemplateModalProps) {
    const [form, setForm] = useState<FormState>(defaultForm);
    const [submitting, setSubmitting] = useState(false);

    // Reset / hydrate when the modal opens or `existing` flips
    useEffect(() => {
        if (!isOpen) return;
        if (existing) {
            setForm({
                name: existing.name,
                language: existing.language,
                purpose: existing.purpose,
                category: existing.category,
                variableCount: existing.variableCount,
                bodyPreview: existing.bodyPreview ?? '',
                isApproved: existing.isApproved,
            });
        } else {
            setForm(defaultForm);
        }
    }, [isOpen, existing]);

    const expectedOrder = TEMPLATE_VARIABLE_ORDER[form.purpose] ?? [];

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (existing) {
                await api.patch(`/templates/${existing.id}`, {
                    name: form.name,
                    language: form.language,
                    category: form.category,
                    variableCount: form.variableCount,
                    bodyPreview: form.bodyPreview || undefined,
                    isApproved: form.isApproved,
                });
                toast.success('Template updated');
            } else {
                await api.post('/templates', {
                    name: form.name,
                    language: form.language,
                    purpose: form.purpose,
                    category: form.category,
                    variableCount: form.variableCount,
                    bodyPreview: form.bodyPreview || undefined,
                    isApproved: form.isApproved,
                });
                toast.success('Template registered');
            }
            await onSaved();
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Save failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={existing ? 'Edit Template' : 'Register Template'}
            maxWidth="max-w-lg"
        >
            <form onSubmit={submit} className="space-y-4">
                <DashboardInput
                    label="Meta template name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="booking_confirmation_v1"
                    required
                    minLength={1}
                />

                <DashboardInput
                    label="Language"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    placeholder="en_US"
                    required
                    minLength={2}
                />

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Purpose
                    </label>
                    <select
                        value={form.purpose}
                        onChange={(e) => {
                            const purpose = e.target.value as TemplatePurpose;
                            setForm({
                                ...form,
                                purpose,
                                // Auto-set variableCount from the expected order
                                variableCount: TEMPLATE_VARIABLE_ORDER[purpose].length,
                            });
                        }}
                        disabled={!!existing}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                    >
                        {PURPOSES.map((p) => (
                            <option key={p} value={p}>
                                {p.replace(/_/g, ' ').toLowerCase()}
                            </option>
                        ))}
                    </select>
                    {existing && (
                        <p className="text-xs text-slate-400">
                            Purpose can&apos;t be changed after registration.
                        </p>
                    )}
                </div>

                {expectedOrder.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Expected variable order (must match your Meta template body):
                        </p>
                        <ol className="text-xs text-slate-500 dark:text-slate-400 list-decimal list-inside space-y-0.5">
                            {expectedOrder.map((v, i) => (
                                <li key={v}>
                                    <code className="text-emerald-700 dark:text-emerald-400">
                                        {`{{${i + 1}}}`}
                                    </code>{' '}
                                    → {v}
                                </li>
                            ))}
                        </ol>
                    </div>
                )}

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Category
                    </label>
                    <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value as TemplateCategory })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                </div>

                <DashboardInput
                    label="Variable count"
                    type="number"
                    min={0}
                    max={20}
                    value={form.variableCount}
                    onChange={(e) =>
                        setForm({ ...form, variableCount: parseInt(e.target.value || '0', 10) })
                    }
                    required
                />

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Body preview (optional)
                    </label>
                    <textarea
                        value={form.bodyPreview}
                        onChange={(e) => setForm({ ...form, bodyPreview: e.target.value })}
                        placeholder="Hi {{1}}, your {{2}} booking on {{3}} at {{4}} is confirmed. Ref: {{5}}"
                        rows={3}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={form.isApproved}
                        onChange={(e) => setForm({ ...form, isApproved: e.target.checked })}
                        className="accent-emerald-500"
                    />
                    Approved by Meta (turn on once the template is approved in Business Manager)
                </label>

                <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={submitting}>
                        {submitting ? 'Saving…' : existing ? 'Save changes' : 'Register'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
