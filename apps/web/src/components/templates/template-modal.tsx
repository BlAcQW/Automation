'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal, Button, DashboardInput, Select, Textarea, Switch } from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';

/** "BOOKING_REMINDER" → "Booking reminder". */
function humanise(value: string): string {
    const words = value.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

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
                notify.success('Template saved');
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
                notify.success('Template added');
            }
            await onSaved();
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Oops, that didn't save. Let's try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={existing ? 'Edit template' : 'Add a template'}
            description="Use the exact details from WhatsApp Business Manager."
            maxWidth="max-w-lg"
        >
            <form onSubmit={submit} className="space-y-4">
                <DashboardInput
                    label="Template name (exactly as in WhatsApp)"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="booking_confirmation_v1"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    minLength={1}
                />

                <DashboardInput
                    label="Language code"
                    hint="For example en_US or en_GB. It's shown next to the template in WhatsApp."
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    placeholder="en_US"
                    autoCapitalize="none"
                    required
                    minLength={2}
                />

                <Select
                    label="What it's for"
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
                    hint={existing ? "You can't change this after adding the template." : undefined}
                >
                    {PURPOSES.map((p) => (
                        <option key={p} value={p}>
                            {humanise(p)}
                        </option>
                    ))}
                </Select>

                {expectedOrder.length > 0 && (
                    <div className="rounded-control border border-border bg-surface-2 p-4">
                        <p className="text-small font-semibold text-text">
                            Fill-ins, in this order (must match your WhatsApp template):
                        </p>
                        <ol className="mt-2 space-y-1 text-[15px] text-muted">
                            {expectedOrder.map((v, i) => (
                                <li key={v} className="flex items-center gap-2">
                                    <code className="rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[13px] font-semibold text-primary">
                                        {`{{${i + 1}}}`}
                                    </code>
                                    <span>{v}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}

                <Select
                    label="WhatsApp category"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as TemplateCategory })}
                >
                    {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                            {humanise(c)}
                        </option>
                    ))}
                </Select>

                <DashboardInput
                    label="Number of fill-ins"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={20}
                    value={form.variableCount}
                    onChange={(e) =>
                        setForm({ ...form, variableCount: parseInt(e.target.value || '0', 10) })
                    }
                    required
                />

                <Textarea
                    label="Message preview (optional)"
                    value={form.bodyPreview}
                    onChange={(e) => setForm({ ...form, bodyPreview: e.target.value })}
                    placeholder="Hi {{1}}, your {{2}} booking on {{3}} at {{4}} is confirmed. Ref: {{5}}"
                    rows={3}
                />

                <div className="flex items-start justify-between gap-4 rounded-control border border-border p-4">
                    <div>
                        <p className="font-semibold text-text">Approved by WhatsApp</p>
                        <p className="text-small text-muted">Turn this on once WhatsApp shows the template as approved.</p>
                    </div>
                    <Switch
                        checked={form.isApproved}
                        onChange={(next) => setForm({ ...form, isApproved: next })}
                        label="Approved by WhatsApp"
                    />
                </div>

                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={submitting} loadingText="Saving…">
                        {existing ? 'Save changes' : 'Add template'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
