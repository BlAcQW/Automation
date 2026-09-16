'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { FileText, Pencil, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TemplateModal, TEMPLATE_VARIABLE_ORDER, type TemplateRow } from '@/components/templates/template-modal';
import { PageHeader } from '@/components/ui/page-header';

export default function TemplatesPage() {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<TemplateRow | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    const { data, isLoading } = useQuery({
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
        if (!confirm(`Delete template "${t.name}"?`)) return;
        try {
            await api.delete(`/templates/${t.id}`);
            toast.success('Template deleted');
            await queryClient.invalidateQueries({ queryKey: ['templates'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Delete failed');
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Message templates"
                subtitle="WhatsApp only lets a business message a customer more than a day after their last reply if the message uses a template WhatsApp has approved. Reminders and confirmations need one."
                actions={<Button onClick={openCreate}>Add template</Button>}
            />

            <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                    Templates are written and approved in{' '}
                    <a
                        href="https://business.facebook.com/wa/manage/message-templates/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium underline"
                    >
                        WhatsApp Business Manager <ExternalLink className="w-3 h-3" />
                    </a>
                    . Once one is approved, add its exact name here and say what it is for
                    (a reminder, a confirmation). If you are not sure, ask whoever set up your
                    WhatsApp account, or contact support and we will do it with you.
                </p>
            </Card>

            <Card>
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                    </div>
                ) : !data?.data?.length ? (
                    <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
                        <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
                        <p className="font-medium text-slate-900 dark:text-white">No templates yet</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                            Until you add one, appointment reminders and confirmations that fall
                            outside the 24-hour window show up here as alerts for you to send by
                            hand instead of going out automatically.
                        </p>
                        <Button onClick={openCreate} className="mt-4">
                            Add your first template
                        </Button>
                    </div>
                ) : (
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-sm text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                    <th className="px-6 py-4 font-medium">Name</th>
                                    <th className="px-6 py-4 font-medium">Purpose</th>
                                    <th className="px-6 py-4 font-medium">Language</th>
                                    <th className="px-6 py-4 font-medium">Variables</th>
                                    <th className="px-6 py-4 font-medium">Status</th>
                                    <th className="px-6 py-4 font-medium w-1"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.data.map((t) => {
                                    const order = TEMPLATE_VARIABLE_ORDER[t.purpose] ?? [];
                                    return (
                                        <tr
                                            key={t.id}
                                            className="border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                        >
                                            <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                                {t.name}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                                                {t.purpose.replace(/_/g, ' ').toLowerCase()}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                                                {t.language}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                                                {t.variableCount}
                                                {order.length > 0 && (
                                                    <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                                                        ({order.join(', ')})
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <Badge variant={t.isApproved ? 'default' : 'yellow'}>
                                                    {t.isApproved ? 'Approved' : 'Pending'}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => openEdit(t)}
                                                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                                        aria-label="Edit template"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => remove(t)}
                                                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                        aria-label="Delete template"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Mobile: stacked template cards */}
                {!isLoading && !!data?.data?.length && (
                    <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
                        {data.data.map((t) => (
                            <div key={t.id} className="flex items-start gap-3 p-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium text-slate-900 dark:text-white truncate">{t.name}</p>
                                        <Badge variant={t.isApproved ? 'default' : 'yellow'}>
                                            {t.isApproved ? 'Approved' : 'Pending'}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                                        {t.purpose.replace(/_/g, ' ').toLowerCase()} · {t.language} · {t.variableCount} vars
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => openEdit(t)}
                                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                        aria-label="Edit template"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => remove(t)}
                                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                        aria-label="Delete template"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <TemplateModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                existing={editing}
                onSaved={async () => {
                    await queryClient.invalidateQueries({ queryKey: ['templates'] });
                    setModalOpen(false);
                }}
            />
        </div>
    );
}
