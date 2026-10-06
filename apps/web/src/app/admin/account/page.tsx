'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, ShieldCheck, Copy } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Input } from '@bookingflow/ui';
import { useAdmin } from '../admin-context';
import { errorMessage, ROLE_LABEL } from '../_components/format';

export default function AdminAccountPage() {
    const { admin } = useAdmin();
    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold text-white">My account</h1>
                <p className="text-slate-400">
                    Signed in as {admin?.email} <Badge variant="slate">{ROLE_LABEL[admin?.role ?? ''] ?? admin?.role}</Badge>
                </p>
            </div>
            <PasswordCard />
            <TwoFactorCard />
            {admin?.role === 'OWNER' && <TwoFactorPolicyCard />}
        </div>
    );
}

function PasswordCard() {
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
        } catch (err) {
            toast.error(errorMessage(err, 'Could not change the password'));
        } finally {
            setSaving(false);
        }
    };

    return (
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
    );
}

function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error('Could not copy'));
}

function TwoFactorCard() {
    const { admin, reload } = useAdmin();
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    // Shown ONCE: the secret after enrol, the recovery codes after verify/regenerate.
    const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    const enabled = !!admin?.totpEnabled;

    const run = async (fn: () => Promise<void>, failure: string) => {
        setBusy(true);
        try { await fn(); } catch (err) { toast.error(errorMessage(err, failure)); } finally { setBusy(false); }
    };

    const startEnrol = (e: React.FormEvent) => {
        e.preventDefault();
        return run(async () => {
            const res = await adminApi.post('/admin/auth/2fa/enrol', { password });
            setEnrol(res.data);
            setPassword('');
        }, 'Could not start two-factor setup');
    };

    const verify = (e: React.FormEvent) => {
        e.preventDefault();
        return run(async () => {
            const res = await adminApi.post('/admin/auth/2fa/verify', { code });
            setRecoveryCodes(res.data.recoveryCodes);
            setEnrol(null);
            setCode('');
            await reload();
            toast.success('Two-factor sign-in is on');
        }, 'That code did not work');
    };

    const disable = (e: React.FormEvent) => {
        e.preventDefault();
        return run(async () => {
            await adminApi.post('/admin/auth/2fa/disable', { password, code });
            setPassword(''); setCode('');
            await reload();
            toast.success('Two-factor sign-in is off');
        }, 'Could not turn off two-factor');
    };

    const regenerate = () =>
        run(async () => {
            const res = await adminApi.post('/admin/auth/2fa/recovery-codes', { password, code });
            setRecoveryCodes(res.data.recoveryCodes);
            setPassword(''); setCode('');
            await reload();
        }, 'Could not make new recovery codes');

    return (
        <Card className="glass-card border-white/5">
            <CardHeader>
                <CardTitle>
                    <ShieldCheck className="w-5 h-5 text-emerald-400" /> Two-factor sign-in
                    <Badge variant={enabled ? 'default' : 'slate'}>{enabled ? 'On' : 'Off'}</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {admin?.twoFactorRequired && !enabled && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                        The platform owner requires two-factor for every admin. Set it up to unlock the console.
                    </p>
                )}

                {recoveryCodes && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                        <p className="text-sm font-medium text-emerald-300">Save these recovery codes now. They are shown once and each works once.</p>
                        <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-white">
                            {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
                        </ul>
                        <div className="mt-3 flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')}><Copy className="w-4 h-4" /> Copy all</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setRecoveryCodes(null)}>I have saved them</Button>
                        </div>
                    </div>
                )}

                {!enabled && !enrol && (
                    <form onSubmit={startEnrol} className="space-y-3">
                        <p className="text-sm text-slate-400">Use an authenticator app (Google Authenticator, 1Password, Authy). Confirm your password to begin.</p>
                        <Input type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                        <Button type="submit" isLoading={busy}>Set up two-factor</Button>
                    </form>
                )}

                {!enabled && enrol && (
                    <form onSubmit={verify} className="space-y-3">
                        <p className="text-sm text-slate-300">Add this account to your authenticator app, then type the 6-digit code it shows. The secret is shown only now.</p>
                        <div className="rounded-lg bg-slate-900/60 p-3">
                            <p className="text-xs text-slate-500">Secret key</p>
                            <p className="font-mono text-sm tracking-wider text-white break-all">{enrol.secret}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => copy(enrol.secret, 'Secret')}><Copy className="w-4 h-4" /> Copy secret</Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => copy(enrol.otpauthUri, 'Setup link')}><Copy className="w-4 h-4" /> Copy otpauth link</Button>
                            </div>
                        </div>
                        <Input label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
                        <Button type="submit" isLoading={busy}>Turn on</Button>
                    </form>
                )}

                {enabled && (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-400">
                            Recovery codes left: <span className="text-white">{admin?.recoveryCodesRemaining ?? 0}</span>. To turn it off or make new codes, confirm your password and a current code.
                        </p>
                        <form onSubmit={disable} className="space-y-3">
                            <Input type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                            <Input label="Current code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" onClick={regenerate} disabled={busy || !password || !code}>New recovery codes</Button>
                                <Button type="submit" variant="destructive" disabled={busy}>Turn off two-factor</Button>
                            </div>
                        </form>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function TwoFactorPolicyCard() {
    const { admin, reload } = useAdmin();
    const [busy, setBusy] = useState(false);
    const required = !!admin?.twoFactorRequired;

    const set = async (next: boolean) => {
        setBusy(true);
        try {
            await adminApi.put('/admin/security/two-factor', { required: next });
            await reload();
            toast.success(next ? 'Two-factor is now required for every admin' : 'Two-factor is no longer required');
        } catch (err) {
            toast.error(errorMessage(err, 'Could not change the policy'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="glass-card border-white/5">
            <CardHeader><CardTitle>Require two-factor for all admins</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-slate-400">
                    When on, an admin who has not set up two-factor can sign in but can only reach this page until they do. You need two-factor on your own account first.
                </p>
                <Button
                    variant={required ? 'outline' : 'default'}
                    onClick={() => set(!required)}
                    isLoading={busy}
                    disabled={!required && !admin?.totpEnabled}
                >
                    {required ? 'Stop requiring it' : 'Require it for everyone'}
                </Button>
                {!required && !admin?.totpEnabled && <p className="text-xs text-amber-300">Turn on your own two-factor first.</p>}
            </CardContent>
        </Card>
    );
}
