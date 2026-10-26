'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Wallet, Clock, Send, ShieldCheck, Smartphone, Check } from 'lucide-react';
import { api } from '@/lib/api';
import {
    PageHeader,
    SectionHeading,
    Card,
    CardContent,
    Button,
    Modal,
    DashboardInput,
    MoneyInput,
    PhoneInput,
    Select,
    StatusPill,
    EmptyState,
    ErrorState,
    Skeleton,
    SkeletonCard,
    TickPop,
    formatCedi,
} from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';

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
            hint={error ? undefined : 'The same password you use to sign in. We ask so nobody else can move your money.'}
            aria-invalid={error ? true : undefined}
        />
    );
}

/** Minor units to something a person reads. Never a float in, never one out. */
function money(minor: number, currency: string): string {
    if (currency === 'GHS') return formatCedi(minor, { fromPesewas: true });
    return `${currency} ${(minor / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/** Ghana MoMo numbers go to the API in the local `0XXXXXXXXX` form people type. */
function toLocalNumber(display: string, e164: string | null): string {
    return e164 ? `0${e164.slice(4)}` : display;
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

    const header = <PageHeader title="Your money" subtitle="What you've earned, and getting it to your phone." />;

    if (loading) {
        return (
            <div className="space-y-6" aria-busy="true">
                <span className="sr-only">Loading…</span>
                {header}
                <div className="grid gap-4 sm:grid-cols-3">
                    <Skeleton className="h-32 rounded-card" />
                    <Skeleton className="h-32 rounded-card" />
                    <Skeleton className="h-32 rounded-card" />
                </div>
                <SkeletonCard />
                <SkeletonCard />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {header}

            {!state ? (
                <ErrorState
                    description={error ?? undefined}
                    onRetry={() => { setLoading(true); setError(null); load(); }}
                />
            ) : (
                <>
                    {error && (
                        <div role="alert" className="rounded-control border border-error/30 bg-error-soft p-4 text-[15px] text-error-fg">
                            {error}
                        </div>
                    )}
                    {done && (
                        <Card>
                            <CardContent className="flex items-center gap-4" role="status">
                                <TickPop key={done} size={44} label="Done" />
                                <p className="text-[15px] text-text">{done}</p>
                            </CardContent>
                        </Card>
                    )}

                    <BalanceCard
                        state={state}
                        onWithdrawn={(msg) => { setDone(msg); setError(null); notify.success('Money on the way'); load(); }}
                        onError={setError}
                    />
                    <DestinationCard
                        state={state}
                        onSaved={(msg) => { setDone(msg); setError(null); notify.success('Number saved'); load(); }}
                        onError={setError}
                    />
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
    const amountMinor = Math.round((parseFloat(amount.replace(/,/g, '')) || 0) * 100);
    const tooMuch = amountMinor > ready;

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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-stretch">
                    <div className="rounded-card bg-primary p-5 text-primary-fg shadow-card">
                        <div className="flex items-center gap-2 text-small text-primary-fg/80">
                            <Wallet className="h-4 w-4" aria-hidden /> Ready to withdraw
                        </div>
                        <p className="mt-3 break-words text-[32px] font-bold leading-none tabular-nums">
                            {money(ready, state.currency)}
                        </p>
                    </div>
                    <div className="rounded-card border border-border bg-surface-2 p-5">
                        <div className="flex items-center gap-2 text-small text-muted">
                            <Clock className="h-4 w-4" aria-hidden /> Still clearing
                        </div>
                        <p className="mt-2 text-[24px] font-bold tabular-nums text-text">
                            {money(state.stillClearingMinor, state.currency)}
                        </p>
                        <p className="mt-1 text-small text-muted">
                            Deposits for jobs you haven&apos;t marked done yet.
                        </p>
                    </div>
                    {state.onTheWayMinor > 0 && (
                        <div className="rounded-card border border-border bg-surface-2 p-5">
                            <div className="flex items-center gap-2 text-small text-muted">
                                <Send className="h-4 w-4" aria-hidden /> On the way
                            </div>
                            <p className="mt-2 text-[24px] font-bold tabular-nums text-text">
                                {money(state.onTheWayMinor, state.currency)}
                            </p>
                        </div>
                    )}
                </div>

                {!state.destination ? (
                    <div className="rounded-control border border-warning/40 bg-warning-soft p-4 text-[15px] text-warning-fg">
                        Add the Mobile Money number you want to be paid on, below, and you can
                        withdraw whenever you like.
                    </div>
                ) : !state.destination.usable ? (
                    <div className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning-soft p-4 text-[15px] text-warning-fg">
                        <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                        Your new number is not active yet. For your safety it can receive money 24
                        hours after you change it.
                    </div>
                ) : (
                    <div className="space-y-3">
                        <SectionHeading as="h2" title="Send money to your MoMo" />
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                            <div className="w-full sm:max-w-xs">
                                <MoneyInput
                                    id="money-withdraw-amount"
                                    label="How much?"
                                    value={amount}
                                    onChange={(text) => setAmount(text)}
                                    error={amount && tooMuch ? `You can send up to ${money(ready, state.currency)}.` : undefined}
                                    hint={!(amount && tooMuch) && ready > 0 ? `Up to ${money(ready, state.currency)}` : undefined}
                                />
                            </div>
                            <div className="flex flex-wrap gap-2 sm:pt-7">
                                <Button
                                    variant="accent"
                                    onClick={() => setConfirming(true)}
                                    disabled={!canWithdraw}
                                >
                                    <Send className="h-4 w-4" aria-hidden /> Send to my MoMo
                                </Button>
                                {ready > 0 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setAmount((ready / 100).toFixed(2))}
                                    >
                                        Send everything
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* Restate the amount AND the destination before committing. An
                irreversible money action should never rest on a number the
                person typed a moment ago and can no longer see. */}
            <Modal
                isOpen={confirming}
                onClose={() => { if (!sending) closeConfirm(); }}
                title="Send this money?"
                description="Check the details. Once sent, it can't be taken back."
            >
                <form className="space-y-4" onSubmit={send} noValidate>
                    <div className="space-y-2 rounded-control bg-surface-2 p-4">
                        <Row label="Amount" value={money(amountMinor, state.currency)} strong />
                        <Row label="To" value={state.destination?.accountName ?? ''} />
                        <Row label="Number" value={state.destination?.accountNumberMasked ?? ''} />
                        <Row label="Network" value={state.destination?.provider ?? ''} />
                    </div>
                    <p className="text-[15px] text-muted">
                        Mobile Money usually arrives within a few minutes.
                    </p>
                    <StepUpPasswordField
                        inputRef={passwordRef}
                        value={password}
                        onChange={(v) => { setPassword(v); setPasswordError(null); }}
                        error={passwordError}
                        autoFocus
                    />
                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                        <Button type="button" variant="secondary" onClick={closeConfirm} disabled={sending}>
                            Not now
                        </Button>
                        <Button type="submit" isLoading={sending} loadingText="Sending…">
                            <Check className="h-4 w-4" aria-hidden />
                            Yes, send it
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
            <span className="text-small text-muted">{label}</span>
            <span className={`min-w-0 break-words text-right tabular-nums ${strong ? 'text-[18px] font-bold text-text' : 'text-[15px] text-text'}`}>
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
    const [display, setDisplay] = useState('');
    const [e164, setE164] = useState<string | null>(null);
    const [resolvedName, setResolvedName] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [saving, setSaving] = useState(false);
    // Lives only while the form is open; cleared on every outcome.
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    const number = toLocalNumber(display, e164);

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
            setDisplay('');
            setE164(null);
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

    const showInvalid = display.replace(/\D/g, '').length >= 9 && !e164;

    return (
        <Card>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                            <Smartphone className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-section-heading text-text">Where your money goes</h2>
                            {state.destination ? (
                                <div className="mt-1 space-y-1">
                                    <p className="break-words text-[15px] text-text">
                                        {state.destination.accountName} · {state.destination.accountNumberMasked}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2 text-small text-muted">
                                        {state.destination.provider}
                                        {state.destination.usable
                                            ? <StatusPill status="active" label="Ready" size="sm" />
                                            : <StatusPill status="pending" label="Active in 24 hours" size="sm" />}
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-1 text-[15px] text-muted">
                                    Not set yet. Add the Mobile Money number you already use.
                                </p>
                            )}
                        </div>
                    </div>
                    <Button variant={state.destination ? 'secondary' : 'primary'} onClick={() => setOpen(true)} className="shrink-0">
                        {state.destination ? 'Change number' : 'Add MoMo number'}
                    </Button>
                </div>

                {state.destination && (
                    <p className="flex items-start gap-2 text-small text-muted">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                        If you change this number it can only receive money after 24 hours, and we
                        will tell you it changed. That is to protect you if someone gets into your
                        account.
                    </p>
                )}
            </CardContent>

            <Modal isOpen={open} onClose={() => { if (!saving) closeForm(); }} title="Where should we send your money?">
                <form className="space-y-4" onSubmit={save} noValidate>
                    <fieldset>
                        <legend className="mb-2 text-small text-text">Mobile money network</legend>
                        {providers.length === 0 ? (
                            <Skeleton className="h-11 w-full rounded-control" />
                        ) : providers.length <= 4 ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
                                {providers.map((p) => {
                                    const selected = provider === p.code;
                                    return (
                                        <label
                                            key={p.code}
                                            className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-control border px-4 text-[15px] transition-colors duration-ui has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${selected ? 'border-primary bg-primary-soft font-semibold text-text' : 'border-border bg-surface text-text hover:bg-surface-2'}`}
                                        >
                                            <input
                                                type="radio"
                                                name="momo-network"
                                                value={p.code}
                                                checked={selected}
                                                onChange={() => { setProvider(p.code); setResolvedName(null); }}
                                                className="sr-only"
                                            />
                                            <span
                                                aria-hidden
                                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-primary bg-primary' : 'border-border'}`}
                                            >
                                                {selected && <Check className="h-3 w-3 text-primary-fg" strokeWidth={3} />}
                                            </span>
                                            {p.name}
                                        </label>
                                    );
                                })}
                            </div>
                        ) : (
                            <Select
                                aria-label="Mobile money network"
                                value={provider}
                                onChange={(e) => { setProvider(e.target.value); setResolvedName(null); }}
                            >
                                {providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                            </Select>
                        )}
                    </fieldset>

                    <PhoneInput
                        id="money-momo-number"
                        label="Mobile Money number"
                        value={display}
                        onChange={(d, normalised) => { setDisplay(d); setE164(normalised); setResolvedName(null); }}
                        error={showInvalid ? 'That does not look like a Ghana number. Check it and try again.' : undefined}
                    />

                    {resolvedName && (
                        <div className="rounded-control border border-primary/30 bg-primary-soft p-4" role="status">
                            <p className="text-small text-muted">This number belongs to</p>
                            <p className="text-[17px] font-bold text-text">{resolvedName}</p>
                            <p className="mt-1 text-small text-muted">
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

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={check}
                            disabled={checking || number.replace(/\D/g, '').length < 6}
                            isLoading={checking}
                            loadingText="Checking…"
                        >
                            Check this number
                        </Button>
                        <Button
                            type="submit"
                            disabled={!canSave}
                            isLoading={saving}
                            loadingText="Saving…"
                        >
                            Save number
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
                    <EmptyState
                        icon={<Send className="h-6 w-6" aria-hidden />}
                        title="No withdrawals yet"
                        description="Money you send to your MoMo will show up here."
                        action={state.destination?.usable && state.readyToWithdrawMinor > 0 ? (
                            <Button
                                variant="secondary"
                                onClick={() => document.getElementById('money-withdraw-amount')?.focus()}
                            >
                                Withdraw now
                            </Button>
                        ) : undefined}
                    />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardContent className="space-y-3">
                <SectionHeading as="h2" title="Recent withdrawals" />
                <ul className="divide-y divide-border">
                    {state.recentPayouts.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="text-[16px] font-semibold tabular-nums text-text">
                                    {money(p.amountMinor, p.currency)}
                                </p>
                                <p className="break-words text-small text-muted">
                                    {new Date(p.createdAt).toLocaleDateString()}
                                    {p.failureReason ? ` · ${p.failureReason}` : ''}
                                </p>
                            </div>
                            <PayoutBadge status={p.status} />
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

/** Three plain states, word plus icon plus colour — never colour alone. */
function PayoutBadge({ status }: { status: Payout['status'] }) {
    if (status === 'PAID') return <StatusPill status="paid" label="Arrived" />;
    if (status === 'FAILED' || status === 'CANCELLED') return <StatusPill status="failed" label="Did not go" />;
    return <StatusPill status="pending" label="On the way" />;
}
