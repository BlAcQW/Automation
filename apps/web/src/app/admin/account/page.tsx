'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, ShieldCheck, Copy } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Input, PageHeader, StatusPill } from '@bookingflow/ui';
import { useAdmin } from '../admin-context';
import { errorMessage, ROLE_LABEL } from '../_components/format';

export default function AdminAccountPage() {
    const { admin } = useAdmin();
    return (
        <div className="max-w-2xl space-y-6">
            <PageHeader
                title="My account"
                eyebrow={
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="break-all">Signed in as {admin?.email}</span>
                        <Badge variant="neutral">{ROLE_LABEL[admin?.role ?? ''] ?? admin?.role}</Badge>
                    </span>
                }
            />
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
        if (next !== confirm) { toast.error("The new passwords don't match. Type them again."); return; }
        setSaving(true);
        try {
            await adminApi.patch('/admin/auth/password', { currentPassword: current, newPassword: next });
            toast.success('Password changed');
            setCurrent(''); setNext(''); setConfirm('');
        } catch (err) {
            toast.error(errorMessage(err, "Couldn't change the password. Let's try again."));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle><KeyRound className="h-5 w-5 text-primary" aria-hidden /> Change password</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-4">
                    <Input type="password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
                    <Input type="password" label="New password" hint="At least 12 characters." value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
                    <Input
                        type="password"
                        label="Type it again"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        minLength={12}
                        required
                        error={confirm && next && confirm !== next ? "This doesn't match the new password yet." : undefined}
                    />
                    <Button type="submit" isLoading={saving}>Save new password</Button>
                </form>
            </CardContent>
        </Card>
    );
}

function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error("Couldn't copy. Select it and copy it by hand."));
}

function TwoFactorCard() {
    const { admin, reload } = useAdmin();
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    // Shown ONCE: the secret after enrol, the recovery codes after verify/regenerate.
    const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    const [confirmDisable, setConfirmDisable] = useState(false);
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

    // The form asks first; the request goes out only from the confirm dialog.
    const askDisable = (e: React.FormEvent) => {
        e.preventDefault();
        setConfirmDisable(true);
    };

    const disable = () =>
        run(async () => {
            await adminApi.post('/admin/auth/2fa/disable', { password, code });
            setPassword(''); setCode('');
            setConfirmDisable(false);
            await reload();
            toast.success('Two-step sign-in is off');
        }, "Couldn't turn off two-step sign-in");

    const regenerate = () =>
        run(async () => {
            const res = await adminApi.post('/admin/auth/2fa/recovery-codes', { password, code });
            setRecoveryCodes(res.data.recoveryCodes);
            setPassword(''); setCode('');
            await reload();
        }, 'Could not make new recovery codes');

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex-wrap">
                    <ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Two-step sign-in
                    <StatusPill size="sm" status={enabled ? 'active' : 'inactive'} label={enabled ? 'On' : 'Off'} />
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {admin?.twoFactorRequired && !enabled && (
                    <p className="rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[14px] text-warning-fg">
                        The platform owner asks every admin to use two-step sign-in. Set it up to unlock the console.
                    </p>
                )}

                {recoveryCodes && (
                    <div className="rounded-card border border-success/40 bg-success-soft p-4">
                        <p className="text-[15px] font-semibold text-success-fg">Save these recovery codes now. You&apos;ll only see them once, and each one works once.</p>
                        <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-[14px] text-text">
                            {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
                        </ul>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" size="sm" onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')}><Copy className="h-4 w-4" aria-hidden /> Copy all</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setRecoveryCodes(null)}>I have saved them</Button>
                        </div>
                    </div>
                )}

                {!enabled && !enrol && (
                    <form onSubmit={startEnrol} className="space-y-3">
                        <p className="text-[15px] text-muted">Use an authenticator app (Google Authenticator, 1Password, Authy). Confirm your password to begin.</p>
                        <Input type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                        <Button type="submit" isLoading={busy}>Set up two-step sign-in</Button>
                    </form>
                )}

                {!enabled && enrol && (
                    <form onSubmit={verify} className="space-y-3">
                        <p className="text-[15px] text-text">Add this account to your authenticator app, then type the 6-digit code it shows. You&apos;ll only see the secret now.</p>
                        <div className="rounded-control bg-surface-2 p-3">
                            <p className="text-[13px] text-muted">Secret key</p>
                            <p className="font-mono text-[14px] tracking-wider text-text break-all">{enrol.secret}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button type="button" variant="secondary" size="sm" onClick={() => copy(enrol.secret, 'Secret')}><Copy className="h-4 w-4" aria-hidden /> Copy secret</Button>
                                <Button type="button" variant="secondary" size="sm" onClick={() => copy(enrol.otpauthUri, 'Setup link')}><Copy className="h-4 w-4" aria-hidden /> Copy setup link</Button>
                            </div>
                        </div>
                        <Input label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
                        <Button type="submit" isLoading={busy}>Turn on</Button>
                    </form>
                )}

                {enabled && (
                    <div className="space-y-3">
                        <p className="text-[15px] text-muted">
                            Recovery codes left: <span className="font-semibold text-text">{admin?.recoveryCodesRemaining ?? 0}</span>. To turn it off or make new codes, confirm your password and a current code.
                        </p>
                        <form onSubmit={askDisable} className="space-y-3">
                            <Input type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                            <Input label="Current code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="secondary" onClick={regenerate} disabled={busy || !password || !code}>New recovery codes</Button>
                                <Button type="submit" variant="destructive" disabled={busy}>Turn off two-step sign-in</Button>
                            </div>
                        </form>
                        <ConfirmDialog
                            isOpen={confirmDisable}
                            onClose={() => setConfirmDisable(false)}
                            onConfirm={disable}
                            title="Turn off two-step sign-in?"
                            description="Your account will be protected by your password only. If the platform requires it, the console locks until you turn it back on."
                            confirmLabel="Turn it off"
                            isLoading={busy}
                        />
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
            toast.success(next ? 'Two-step sign-in is now required for every admin' : 'Two-step sign-in is no longer required');
        } catch (err) {
            toast.error(errorMessage(err, "Couldn't change the setting. Let's try again."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle>Require two-step sign-in for all admins</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                <p className="text-[15px] text-muted">
                    When on, an admin without two-step sign-in can sign in but only reach this page until they set it up. Turn it on for your own account first.
                </p>
                <Button
                    variant={required ? 'secondary' : 'primary'}
                    onClick={() => set(!required)}
                    isLoading={busy}
                    disabled={!required && !admin?.totpEnabled}
                >
                    {required ? 'Stop requiring it' : 'Require it for everyone'}
                </Button>
                {!required && !admin?.totpEnabled && <p className="text-[14px] text-warning-fg">Turn on your own two-step sign-in first.</p>}
            </CardContent>
        </Card>
    );
}
