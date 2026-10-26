'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { FileText, Pencil, Trash2, ExternalLink, Copy, Info, Plus } from 'lucide-react';
import {
    Card,
    Button,
    ConfirmDialog,
    EmptyState,
    ErrorState,
    PageHeader,
    ResponsiveTable,
    SkeletonTableRow,
    SkeletonList,
    StatusPill,
    type Column,
} from '@bookingflow/ui';
import { TemplateModal, TEMPLATE_VARIABLE_ORDER, type TemplateRow } from '@/components/templates/template-modal';
import { SupportLinks } from '@/components/support-links';
import { notify } from '@/components/brand/toast';

/** "BOOKING_REMINDER" → "Booking reminder". */
function purposeLabel(purpose: string): string {
    const words = purpose.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function TemplatesPage() {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<TemplateRow | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleting, setDeleting] = useState<TemplateRow | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['templates'],
        queryFn: async () => {
            const res = await api.get('/templates?limit=100');
            return res.data as { data: TemplateRow[] };
        },
    });

    const openCreate = () => {
        setEditing(null);
        setModalOpen(true);
    };

    const openEdit = (t: TemplateRow) => {
        setEditing(t);
        setModalOpen(true);
    };

    const remove = async (t: TemplateRow) => {
        setDeleteBusy(true);
        try {
            await api.delete(`/templates/${t.id}`);
            notify.success('Template removed');
            setDeleting(null);
            await queryClient.invalidateQueries({ queryKey: ['templates'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Oops, we couldn't remove that template. Let's try again.");
        } finally {
            setDeleteBusy(false);
        }
    };

    const copyName = async (t: TemplateRow) => {
        try {
            await navigator.clipboard.writeText(t.name);
            notify.success('Template name copied');
        } catch {
            notify.error("Couldn't copy. Select the name and copy it by hand.");
        }
    };

    const templates = data?.data ?? [];

    const columns: Column<TemplateRow>[] = [
        {
            key: 'name',
            header: 'Name',
            render: (t) => <span className="break-all font-semibold text-text">{t.name}</span>,
        },
        {
            key: 'purpose',
            header: 'Used for',
            render: (t) => purposeLabel(t.purpose),
        },
        {
            key: 'language',
            header: 'Language',
            render: (t) => <span className="text-muted">{t.language}</span>,
            hideOnMobile: true,
        },
        {
            key: 'variables',
            header: 'Fill-ins',
            render: (t) => {
                const order = TEMPLATE_VARIABLE_ORDER[t.purpose] ?? [];
                return (
                    <span className="tabular-nums">
                        {t.variableCount}
                        {order.length > 0 && (
                            <span className="ml-2 hidden text-small text-muted lg:inline">({order.join(', ')})</span>
                        )}
                    </span>
                );
            },
            hideOnMobile: true,
        },
        {
            key: 'status',
            header: 'Status',
            render: (t) => (
                <StatusPill
                    status={t.isApproved ? 'active' : 'pending'}
                    label={t.isApproved ? 'Approved' : 'Waiting for approval'}
                    size="sm"
                />
            ),
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'right',
            render: (t) => (
                <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => copyName(t)} aria-label={`Copy name ${t.name}`}>
                        <Copy className="h-5 w-5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`}>
                        <Pencil className="h-5 w-5" aria-hidden />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(t)}
                        aria-label={`Remove ${t.name}`}
                        className="text-error-fg hover:bg-error-soft"
                    >
                        <Trash2 className="h-5 w-5" aria-hidden />
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <PageHeader
                title="Message templates"
                subtitle="WhatsApp only lets you message a customer more than a day after their last reply with a template WhatsApp has approved. Reminders and confirmations need one."
                actions={
                    <Button onClick={openCreate}>
                        <Plus className="h-5 w-5" aria-hidden />
                        Add a template
                    </Button>
                }
            />

            <Card className="flex gap-3 border-accent/40 bg-accent-soft p-4 sm:p-5">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-warning-fg" aria-hidden />
                <p className="text-[15px] leading-relaxed text-text">
                    You write templates and get them approved in{' '}
                    <a
                        href="https://business.facebook.com/wa/manage/message-templates/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2"
                    >
                        WhatsApp Business Manager <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                    . Once one is approved, add its exact name here and say what it&apos;s for (a reminder, a
                    confirmation). Not sure? Ask whoever set up your WhatsApp account, or we&apos;ll do it with you:{' '}
                    <SupportLinks inline topic="please help me set up my message templates" />
                </p>
            </Card>

            {isError ? (
                <Card>
                    <ErrorState
                        description="We couldn't load your templates. Nothing has changed. Check your connection, then try again."
                        onRetry={() => refetch()}
                        isRetrying={isRefetching}
                    />
                </Card>
            ) : isLoading ? (
                <Card aria-busy="true" className="overflow-hidden">
                    <span className="sr-only">Loading your templates…</span>
                    <div className="hidden md:block">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <SkeletonTableRow key={i} columns={5} />
                        ))}
                    </div>
                    <SkeletonList rows={4} className="px-4 md:hidden" />
                </Card>
            ) : templates.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={<FileText />}
                        title="No templates yet"
                        description="Until you add one, reminders and confirmations that fall outside WhatsApp's 24-hour window show up as alerts for you to send by hand."
                        action={
                            <Button onClick={openCreate}>
                                <Plus className="h-5 w-5" aria-hidden />
                                Add your first template
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <ResponsiveTable
                    caption="Your message templates"
                    columns={columns}
                    rows={templates}
                    rowKey={(t) => t.id}
                />
            )}

            <TemplateModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                existing={editing}
                onSaved={async () => {
                    await queryClient.invalidateQueries({ queryKey: ['templates'] });
                    setModalOpen(false);
                }}
            />

            <ConfirmDialog
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                onConfirm={() => deleting && remove(deleting)}
                title={`Remove "${deleting?.name ?? 'this template'}"?`}
                description="Bookly will stop using it for automatic messages. It stays in WhatsApp Business Manager, so you can add it back any time."
                confirmLabel="Remove template"
                isLoading={deleteBusy}
            />
        </div>
    );
}
