'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Loader2, Wallet, Clock, Send, ShieldCheck, AlertCircle, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card, CardContent, Button, Badge, Modal, DashboardInput } from '@bookingflow/ui';

interface Destination {
    id: string;
    accountName: string;
    accountNumberMasked: string;
    provider: string;
    usable: boolean;
    usableFrom: string;
}

interface Payout {
    id: string;
    amountMinor: number;
    currency: string;
    status: 'REQUESTED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';
    failureReason: string | null;
    createdAt: string;
    settledAt: string | null;
}

interface MoneyState {
    currency: string;
    readyToWithdrawMinor: number;
    stillClearingMinor: number;
    onTheWayMinor: number;
    destination: Destination | null;
    recentPayouts: Payout[];
}

interface Provider { code: string; name: string }

const PASSWORD_PROMPT = 'Enter your password to confirm.';

/**
 * Sorts a failed money-out request into "ask for the password again" versus
 * anything else (close the password step and show the server's message as it
 * is). Only the server's stable password codes count as password errors: a
 * withdrawal refusal (daily limit, paused) or the "we are checking your
 * balance, do not try again" answer is ALSO a 400, and must neither keep the
 * password form open nor be followed by "Nothing was sent" reassurance, which
 * would be false when a reversal failed. A locked-out owner (PASSWORD_LOCKED)
 * is shown the message and the step closes: retrying cannot help.
 */
const PASSWORD_RETRY_CODES = ['PASSWORD_REQUIRED', 'PASSWORD_INCORRECT'];

function readStepUpError(err: any, fallback: string): { retryPassword: boolean; message: string } {
    const data = err?.response?.data;
    const message: string | undefined = typeof data?.message === 'string' ? data.message : undefined;
    if (PASSWORD_RETRY_CODES.includes(data?.code)) {
        return { retryPassword: true, message: message ?? 'That password is not right. Enter the password you sign in with.' };
    }
    return { retryPassword: false, message: message ?? fallback };
}

/** The "type your password again" box both money-out forms share. */
function StepUpPasswordField({ inputRef, value, onChange, error, autoFocus }: {
    inputRef: RefObject<HTMLInputElement>;
    value: string;
    onChange: (v: string) => void;
    error: string | null;
    autoFocus?: boolean;
}) {
    return (
        <div className="space-y-1">
            <DashboardInput
                ref={inputRef}
                id="money-stepup-password"
                label="Enter your password to confirm"
                type="password"
                autoComplete="current-password"
                autoFocus={autoFocus}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                error={error ?? undefined}
                aria-invalid={error ? true : undefined}
            />
            {!error && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    The same password you use to sign in. We ask so nobody else can move your money.
                </p>
            )}
        </div>
    );
}

/** Minor units to something a person reads. Never a float in, never one out. */
function money(minor: number, currency: string): string {
    return `${currency} ${(minor / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export default function MoneyPage() {
    const [state, setState] = useState<MoneyState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await api.get('/money');
            setState(res.data);
        } catch (err: any) {
            setError(
                err?.response?.status === 403
                    ? 'Only the account owner can see the money page.'
                    : 'We could not load your money right now.',
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center gap-3 py-12 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                Checking your money…
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader title="Money" subtitle="What you've earned, and getting it to your phone." />

            {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    {error}
                </div>
            )}
            {done && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-sm text-emerald-700 dark:text-emerald-300">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" />
                    {done}
                </div>
            )}

            {state && (
                <>
                    <BalanceCard state={state} onWithdrawn={(msg) => { setDone(msg); setError(null); load(); }} onError={setError} />
                    <DestinationCard state={state} onSaved={(msg) => { setDone(msg); setError(null); load(); }} onError={setError} />
                    <HistoryCard state={state} />
                </>
            )}
        </div>
    );
}

function BalanceCard({ state, onWithdrawn, onError }: {
    state: MoneyState;
    onWithdrawn: (msg: string) => void;
    onError: (msg: string) => void;
}) {
    const [amount, setAmount] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [sending, setSending] = useState(false);
    // Lives only for the open confirm box; cleared on every outcome.
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    function closeConfirm() {
        setConfirming(false);
        setPassword('');
        setPasswordError(null);
    }

    const ready = state.readyToWithdrawMinor;
    // Parse in major units, commit in minor. Rounding here rather than
    // trusting a float keeps pesewas whole all the way to the ledger.
    const amountMinor = Math.round((parseFloat(amount) || 0) * 100);

    const canWithdraw =
        !!state.destination?.usable && ready > 0 && amountMinor > 0 && amountMinor <= ready;

    async function send(e?: FormEvent) {
        e?.preventDefault();
        if (sending) return;
        if (!password) {
            setPasswordError(PASSWORD_PROMPT);
            passwordRef.current?.focus();
            return;
        }
        setSending(true);
        const typed = password;
        setPassword('');
        try {
            const res = await api.post('/money/withdraw', { amountMinor, password: typed });
            closeConfirm();
            setAmount('');
            onWithdrawn(res.data.message ?? 'On the way.');
        } catch (err: any) {
            const { retryPassword, message } = readStepUpError(
                err,
                'That did not go through. Your money is still in your balance.',
            );
            if (retryPassword) {
                setPasswordError(`${message} Nothing was sent. Your money is still in your balance.`);
                // Focus after React re-enables the field.
                setTimeout(() => passwordRef.current?.focus(), 0);
            } else {
                closeConfirm();
                onError(message);
            }
        } finally {
            setSending(false);
        }
    }

    return (
        <Card>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <Wallet className="w-3.5 h-3.5" /> Ready to withdraw
                        </div>
                        <p className="text-3xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">
                            {money(ready, state.currency)}
                        </p>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <Clock className="w-3.5 h-3.5" /> Still clearing
                        </div>
                        <p className="text-2xl font-medium text-slate-700 dark:text-slate-200 mt-1 tabular-nums">
                            {money(state.stillClearingMinor, state.currency)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Deposits for jobs you haven&apos;t marked done yet.
                        </p>
                    </div>
                    {state.onTheWayMinor > 0 && (
                        <div>
                            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <Send className="w-3.5 h-3.5" /> On the way
                            </div>
                            <p className="text-2xl font-medium text-slate-700 dark:text-slate-200 mt-1 tabular-nums">
                                {money(state.onTheWayMinor, state.currency)}
                            </p>
                        </div>
                    )}
                </div>

                {!state.destination ? (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-sm text-amber-800 dark:text-amber-200">
                        Add the Mobile Money number you want to be paid on, below, and you can
                        withdraw whenever you like.
                    </div>
                ) : !state.destination.usable ? (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-sm text-amber-800 dark:text-amber-200">
                        Your new number is not active yet. For your safety it can receive money 24
                        hours after you change it.
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div className="sm:max-w-xs w-full">
                            <DashboardInput
                                label={`How much? (${state.currency})`}
                                type="number"
                                inputMode="decimal"
                                min={1}
                                step="1"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0.00"
                            />
                        </div>
                        <Button
                            onClick={() => setConfirming(true)}
                            disabled={!canWithdraw}
                            className="min-h-[44px]"
                        >
                            <Send className="w-4 h-4" /> Send to my MoMo
                        </Button>
                        {ready > 0 && (
                            <button
                                type="button"
                                onClick={() => setAmount((ready / 100).toFixed(2))}
                                className="text-sm text-emerald-600 dark:text-emerald-400 underline min-h-[44px]"
                            >
                                Send everything
                            </button>
                        )}
                    </div>
                )}
            </CardContent>

            {/* Restate the amount AND the destination before committing. An
                irreversible money action should never rest on a number the
                person typed a moment ago and can no longer see. */}
            <Modal isOpen={confirming} onClose={() => { if (!sending) closeConfirm(); }} title="Send this money?">
                <form className="space-y-4" onSubmit={send} noValidate>
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 space-y-2">
                        <Row label="Amount" value={money(amountMinor, state.currency)} strong />
                        <Row label="To" value={state.destination?.accountName ?? ''} />
                        <Row label="Number" value={state.destination?.accountNumberMasked ?? ''} />
                        <Row label="Network" value={state.destination?.provider ?? ''} />
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Mobile Money usually arrives within a few minutes.
                    </p>
                    <StepUpPasswordField
                        inputRef={passwordRef}
                        value={password}
                        onChange={(v) => { setPassword(v); setPasswordError(null); }}
                        error={passwordError}
                        autoFocus
                    />
                    <div className="flex gap-3">
                        <Button type="submit" disabled={sending} className="min-h-[44px]">
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Yes, send it
                        </Button>
                        <Button type="button" variant="outline" onClick={closeConfirm} disabled={sending} className="min-h-[44px]">
                            Not now
                        </Button>
                    </div>
                </form>
            </Modal>
        </Card>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
            <span className={`text-sm ${strong ? 'font-semibold text-lg text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-100'} tabular-nums`}>
                {value}
            </span>
        </div>
    );
}

function DestinationCard({ state, onSaved, onError }: {
    state: MoneyState;
    onSaved: (msg: string) => void;
    onError: (msg: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [provider, setProvider] = useState('');
    const [number, setNumber] = useState('');
    const [resolvedName, setResolvedName] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [saving, setSaving] = useState(false);
    // Lives only while the form is open; cleared on every outcome.
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    function closeForm() {
        setOpen(false);
        setPassword('');
        setPasswordError(null);
    }

    useEffect(() => {
        if (!open || providers.length) return;
        api.get('/money/providers')
            .then((r) => { setProviders(r.data.providers); setProvider(r.data.providers[0]?.code ?? ''); })
            .catch(() => onError('We could not load the mobile money networks.'));
    }, [open, providers.length, onError]);

    // Show whose account it is BEFORE saving: a typo then reads as the wrong
    // name rather than money sent to a stranger.
    async function check() {
        setChecking(true);
        setResolvedName(null);
        try {
            const res = await api.post('/money/destination/preview', { accountNumber: number, provider });
            setResolvedName(res.data.accountName ?? null);
        } catch {
            setResolvedName(null);
        } finally {
            setChecking(false);
        }
    }

    const canSave = number.replace(/\D/g, '').length >= 6 && !!provider;

    async function save(e?: FormEvent) {
        e?.preventDefault();
        if (saving || !canSave) return;
        if (!password) {
            setPasswordError(PASSWORD_PROMPT);
            passwordRef.current?.focus();
            return;
        }
        setSaving(true);
        const typed = password;
        setPassword('');
        try {
            const res = await api.post('/money/destination', {
                accountNumber: number,
                provider,
                accountName: resolvedName ?? undefined,
                password: typed,
            });
            closeForm();
            setNumber('');
            setResolvedName(null);
            onSaved(
                res.data.coolingOffHours
                    ? `Saved. For your safety this number can receive money in ${res.data.coolingOffHours} hours.`
                    : 'Saved. You can withdraw to this number now.',
            );
        } catch (err: any) {
            const { retryPassword, message } = readStepUpError(err, 'We could not save that number.');
            if (retryPassword) {
                setPasswordError(`${message} Your number has not been changed.`);
                setTimeout(() => passwordRef.current?.focus(), 0);
            } else {
                closeForm();
                onError(message);
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="font-medium text-slate-900 dark:text-white text-sm">Where your money goes</p>
                        {state.destination ? (
                            <div className="mt-1 space-y-0.5">
                                <p className="text-sm text-slate-700 dark:text-slate-200">
                                    {state.destination.accountName} · {state.destination.accountNumberMasked}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {state.destination.provider}
                                    {!state.destination.usable && ' · active in 24 hours'}
                                </p>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Not set yet. Add the Mobile Money number you already use.
                            </p>
                        )}
                    </div>
                    <Button variant="outline" onClick={() => setOpen(true)} className="min-h-[44px] shrink-0">
                        {state.destination ? 'Change' : 'Add number'}
                    </Button>
                </div>

                {state.destination && (
                    <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        If you change this number it can only receive money after 24 hours, and we
                        will tell you it changed. That is to protect you if someone gets into your
                        account.
                    </p>
                )}
            </CardContent>

            <Modal isOpen={open} onClose={() => { if (!saving) closeForm(); }} title="Where should we send your money?">
                <form className="space-y-4" onSubmit={save} noValidate>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                            Network
                        </label>
                        <select
                            value={provider}
                            onChange={(e) => { setProvider(e.target.value); setResolvedName(null); }}
                            className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                        >
                            {providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                        </select>
                    </div>

                    <DashboardInput
                        label="Mobile Money number"
                        inputMode="tel"
                        value={number}
                        onChange={(e) => { setNumber(e.target.value); setResolvedName(null); }}
                        placeholder="024 123 4567"
                    />

                    {resolvedName && (
                        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50">
                            <p className="text-xs text-emerald-700 dark:text-emerald-300">This number belongs to</p>
                            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">{resolvedName}</p>
                            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                                Is that you? If not, check the number.
                            </p>
                        </div>
                    )}

                    <StepUpPasswordField
                        inputRef={passwordRef}
                        value={password}
                        onChange={(v) => { setPassword(v); setPasswordError(null); }}
                        error={passwordError}
                    />

                    <div className="flex flex-wrap gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={check}
                            disabled={checking || number.replace(/\D/g, '').length < 6}
                            className="min-h-[44px]"
                        >
                            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Check this number
                        </Button>
                        <Button
                            type="submit"
                            disabled={saving || !canSave}
                            className="min-h-[44px]"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Save
                        </Button>
                    </div>
                </form>
            </Modal>
        </Card>
    );
}

function HistoryCard({ state }: { state: MoneyState }) {
    if (state.recentPayouts.length === 0) {
        return (
            <Card>
                <CardContent>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Money you send to yourself will show up here.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardContent className="space-y-3">
                <p className="font-medium text-slate-900 dark:text-white text-sm">Recent withdrawals</p>
                <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                    {state.recentPayouts.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                            <div>
                                <p className="text-sm font-medium text-slate-900 dark:text-white tabular-nums">
                                    {money(p.amountMinor, p.currency)}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {new Date(p.createdAt).toLocaleDateString()}
                                    {p.failureReason ? ` · ${p.failureReason}` : ''}
                                </p>
                            </div>
                            <PayoutBadge status={p.status} />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

/** Three plain states, word plus colour — never colour alone. */
function PayoutBadge({ status }: { status: Payout['status'] }) {
    if (status === 'PAID') return <Badge variant="default">Arrived</Badge>;
    if (status === 'FAILED' || status === 'CANCELLED') return <Badge variant="red">Did not go</Badge>;
    return <Badge variant="yellow">On the way</Badge>;
}
