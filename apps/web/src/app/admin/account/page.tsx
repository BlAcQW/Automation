'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function AdminAccountPage() {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (next !== confirm) { toast.error('The new passwords do not match'); return; }
        setSaving(true);
        try {
            await adminApi.patch('/admin/auth/password', { currentPassword: current, newPassword: next });
            toast.success('Password changed');
            setCurrent(''); setNext(''); setConfirm('');
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Could not change the password');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6 max-w-lg">
            <div>
                <h1 className="text-2xl font-bold text-white">My account</h1>
                <p className="text-slate-400">Change the password you use for this admin console.</p>
            </div>
            <Card className="glass-card border-white/5">
                <CardHeader>
                    <CardTitle><KeyRound className="w-5 h-5 text-emerald-400" /> Change password</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={submit} className="space-y-4">
                        <Input type="password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
                        <Input type="password" label="New password (12+ characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
                        <Input type="password" label="Type it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required />
                        <Button type="submit" isLoading={saving}>Save new password</Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
