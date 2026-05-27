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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Message Templates</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Register Meta-approved WhatsApp templates so reminders and confirmations
                        get delivered outside the 24-hour customer-service window.
                    </p>
                </div>
                <Button onClick={openCreate}>+ Register Template</Button>
            </div>

            <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                    Templates must be created &amp; approved inside{' '}
                    <a
                        href="https://business.facebook.com/wa/manage/message-templates/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium underline"
                    >
                        Meta Business Manager <ExternalLink className="w-3 h-3" />
                    </a>
                    . Once approved there, register the exact template name here and pick the
                    purpose it serves. Variable order matters — see the hint inside the register form.
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
                        <p className="font-medium text-slate-900 dark:text-white">No templates registered yet</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                            Until you register at least one approved template per notification purpose
                            (booking confirmation, reminder, etc.), the worker will create dashboard
                            alerts instead of sending messages.
                        </p>
                        <Button onClick={openCreate} className="mt-4">
                            + Register your first template
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
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
