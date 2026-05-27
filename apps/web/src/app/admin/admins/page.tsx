'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../layout';
import { UserCog, ShieldOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import toast from 'react-hot-toast';

export default function AdminAdminsPage() {
    const { admin } = useAdmin();
    const queryClient = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState({
        email: '',
        password: '',
        name: '',
        isSuperAdmin: false,
    });

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'admins'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/admins');
            return res.data;
        },
        // Don't even try if the current admin isn't super-admin — API will 403.
        enabled: !!admin?.isSuperAdmin,
    });

    if (!admin?.isSuperAdmin) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-white">Manage Admins</h1>
                </div>
                <Card className="glass-card border-white/5 p-12 text-center">
                    <ShieldOff className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-300 font-medium">Super-admin access required</p>
                    <p className="text-slate-500 text-sm mt-1">
                        Only super admins can view or manage the admin list.
                    </p>
                </Card>
            </div>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await adminApi.post('/admin/admins', form);
            toast.success(`Admin ${form.email} created`);
            setShowCreate(false);
            setForm({ email: '', password: '', name: '', isSuperAdmin: false });
            await queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Failed to create admin');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Manage Admins</h1>
                    <p className="text-slate-400">Add or review platform administrators.</p>
                </div>
                <Button onClick={() => setShowCreate(true)}>+ New Admin</Button>
            </div>

            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                    </div>
                ) : error ? (
                    <div className="p-6 text-red-400">Failed to load admins.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                    <th className="px-6 py-4 font-medium">Name</th>
                                    <th className="px-6 py-4 font-medium">Email</th>
                                    <th className="px-6 py-4 font-medium">Role</th>
                                    <th className="px-6 py-4 font-medium">Status</th>
                                    <th className="px-6 py-4 font-medium">Last Login</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!data?.data?.length ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center">
                                            <UserCog className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                            <p className="text-slate-400">No admins found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    data.data.map((a: any) => (
                                        <tr
                                            key={a.id}
                                            className="border-b border-white/5 hover:bg-white/5 transition-colors"
                                        >
                                            <td className="px-6 py-4 text-white font-medium">{a.name}</td>
                                            <td className="px-6 py-4 text-slate-300">{a.email}</td>
                                            <td className="px-6 py-4">
                                                <Badge variant={a.isSuperAdmin ? 'default' : 'slate'}>
                                                    {a.isSuperAdmin ? 'Super Admin' : 'Admin'}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Badge variant={a.isActive ? 'default' : 'red'}>
                                                    {a.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4 text-slate-400 text-sm">
                                                {a.lastLoginAt
                                                    ? new Date(a.lastLoginAt).toLocaleString()
                                                    : 'Never'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Admin">
                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Name</label>
                        <Input
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            required
                            minLength={2}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Email</label>
                        <Input
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Password</label>
                        <Input
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            required
                            minLength={8}
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                            type="checkbox"
                            checked={form.isSuperAdmin}
                            onChange={(e) => setForm({ ...form, isSuperAdmin: e.target.checked })}
                            className="accent-emerald-500"
                        />
                        Super admin
                    </label>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowCreate(false)}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Creating…' : 'Create'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
