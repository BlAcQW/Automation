'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import {
    AlertCircle, Smartphone, Send, Unplug, Zap, Store, CalendarCheck, ShieldCheck, Sparkles, Link2,
} from 'lucide-react';
import {
    PageHeader,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Button,
    StatusPill,
    DashboardInput,
    PhoneInput,
    Textarea,
    ConfirmDialog,
    SkeletonLine,
    Skeleton,
    TickPop,
    Stagger,
    StaggerItem,
} from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';

declare global {
    interface Window {
        FB: any;
        fbAsyncInit: () => void;
    }
}

interface WhatsAppStatus {
    connected: boolean;
    phoneNumberId?: string;
    displayNumber?: string;
    /** TRUE when the number sits on Bookly's WABA, so we bill for messages. */
    hosted?: boolean;
    numberStatus?: string | null;
    /** Number created on our WABA but not yet verified — show the OTP step. */
    awaitingCode?: boolean;
    /** FALSE when the platform WABA isn't configured; hide the hosted option. */
    hostedAvailable?: boolean;
}

/**
 * Exact origins Meta's Embedded Signup popup posts from (same list the API
 * returns as sessionEvent.origins). Set membership, never suffix matching:
 * "evilfacebook.com" must not pass.
 */
const FACEBOOK_MESSAGE_ORIGINS = new Set([
    'https://www.facebook.com',
    'https://web.facebook.com',
    'https://business.facebook.com',
]);

/** WhatsApp's own colour, used only for the WhatsApp connect button. */
const WA_BUTTON = 'bg-wa-dark text-cream hover:bg-wa-dark/90';

export default function WhatsAppSetupPage() {
    const { tenant } = useAuth();
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState<null | 'disconnect' | 'restart'>(null);
    const [testPhone, setTestPhone] = useState('');
    const [testE164, setTestE164] = useState<string | null>(null);
    const [testMessage, setTestMessage] = useState('Hello! This is a test message from Bookly.');
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    const [sdkFailed, setSdkFailed] = useState(false);

    // --- Bookly-hosted number ---------------------------------------
    // The number is added to Bookly's own WABA, so Meta bills Bookly and the
    // tenant pays us in local currency instead of needing a card Meta accepts.
    const [hostedForm, setHostedForm] = useState({ countryCode: '233', localNumber: '' });
    const [hostedDisplay, setHostedDisplay] = useState('');
    const [hostedSubmitting, setHostedSubmitting] = useState(false);
    const [otp, setOtp] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [resending, setResending] = useState(false);

    async function startHosted(e: React.FormEvent) {
        e.preventDefault();
        setHostedSubmitting(true);
        setMessage(null);
        try {
            const res = await api.post('/whatsapp/hosted/start', hostedForm);
            setMessage({
                type: 'success',
                text: `We sent a 6-digit code to ${res.data.displayNumber}. Enter it below.`,
            });
            notify.success('Code sent');
            await fetchStatus();
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err?.response?.data?.message ?? 'Could not start setup. Check the number and try again.',
            });
        } finally {
            setHostedSubmitting(false);
        }
    }

    async function verifyHosted(e: React.FormEvent) {
        e.preventDefault();
        setVerifying(true);
        setMessage(null);
        try {
            await api.post('/whatsapp/hosted/verify', { code: otp });
            setOtp('');
            setMessage({ type: 'success', text: 'Your WhatsApp number is live.' });
            notify.success('WhatsApp is live');
            await fetchStatus();
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err?.response?.data?.message ?? 'That code was not accepted.',
            });
        } finally {
            setVerifying(false);
        }
    }

    async function resendCode(codeMethod: 'SMS' | 'VOICE') {
        setResending(true);
        setMessage(null);
        try {
            await api.post('/whatsapp/hosted/resend', { codeMethod });
            setMessage({
                type: 'success',
                text: codeMethod === 'VOICE' ? 'Calling you with the code now.' : 'New code sent.',
            });
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err?.response?.data?.message ?? 'Could not resend the code.',
            });
        } finally {
            setResending(false);
        }
    }

    useEffect(() => {
        fetchStatus();
        loadFacebookSDK();
    }, []);

    // Poll for SDK readiness (handles cases where onerror doesn't fire)
    useEffect(() => {
        if (sdkReady || sdkFailed) return;

        const interval = setInterval(() => {
            if (window.FB) {
                setSdkReady(true);
                clearInterval(interval);
            }
        }, 1500);

        // Timeout after 15 seconds — SDK is likely blocked
        const timeout = setTimeout(() => {
            if (!window.FB) {
                setSdkFailed(true);
            }
            clearInterval(interval);
        }, 15000);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [sdkReady, sdkFailed]);

    const fetchStatus = async () => {
        try {
            const response = await api.get('/whatsapp/status');
            setStatus(response.data);
        } catch {
            setMessage({ type: 'error', text: 'We could not check your WhatsApp connection. Refresh to try again.' });
        } finally {
            setLoading(false);
        }
    };

    const loadFacebookSDK = () => {
        window.fbAsyncInit = function () {
            window.FB.init({
                appId: process.env.NEXT_PUBLIC_WHATSAPP_APP_ID,
                cookie: true,
                xfbml: true,
                // Embedded Signup v4 (Meta's implementation guide uses v25.0).
                version: 'v25.0'
            });
            setSdkReady(true);
            setSdkFailed(false);
        };

        if (window.FB) {
            setSdkReady(true);
            return;
        }

        const existing = document.getElementById('facebook-jssdk');
        if (existing) existing.remove();

        const script = document.createElement('script');
        script.id = 'facebook-jssdk';
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.defer = true;
        script.crossOrigin = 'anonymous';
        script.onerror = () => {
            setSdkFailed(true);
            setMessage({ type: 'error', text: 'Facebook could not load. Turn off any ad-blocker for this page and try again.' });
        };
        document.body.appendChild(script);
    };

    const retrySDK = () => {
        setSdkFailed(false);
        setSdkReady(false);
        setMessage(null);
        loadFacebookSDK();
    };

    const launchWhatsAppSignup = () => {
        const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
        const configId = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;

        if (!window.FB) {
            setMessage({ type: 'error', text: 'Facebook could not load. Turn off any ad-blocker and refresh the page.' });
            return;
        }

        if (!appId || !configId) {
            setMessage({
                type: 'error',
                text: `Missing environment variables: ${!appId ? 'NEXT_PUBLIC_WHATSAPP_APP_ID ' : ''}${!configId ? 'NEXT_PUBLIC_WHATSAPP_CONFIG_ID' : ''}. Check your .env file and restart the dev server.`
            });
            return;
        }

        setConnecting(true);
        setMessage(null);

        // Embedded Signup v4 posts the chosen WABA + phone number as a
        // WA_EMBEDDED_SIGNUP window message before the login callback fires.
        // Kept and sent with the code so the server connects exactly that
        // number (it falls back to the first one if no message arrived).
        let sessionInfo: unknown = undefined;
        const onMessage = (event: MessageEvent) => {
            if (!FACEBOOK_MESSAGE_ORIGINS.has(event.origin)) return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data?.type === 'WA_EMBEDDED_SIGNUP') sessionInfo = data;
            } catch {
                /* not ours */
            }
        };
        window.addEventListener('message', onMessage);

        try {
            window.FB.login(
                function (response: any) {
                    // The message event can land just after the callback.
                    setTimeout(() => {
                        window.removeEventListener('message', onMessage);
                        if (response.authResponse) {
                            exchangeCodeForToken(response.authResponse.code, sessionInfo);
                        } else {
                            setConnecting(false);
                            setMessage({ type: 'error', text: 'WhatsApp setup was cancelled. You can try again any time.' });
                        }
                    }, 300);
                },
                {
                    config_id: configId,
                    response_type: 'code',
                    override_default_response_type: true,
                    // v4: the configuration (config_id) decides the version and
                    // products; no version / sessionInfoVersion / featureType.
                    extras: { setup: {} },
                }
            );
        } catch (err: any) {
            window.removeEventListener('message', onMessage);
            setConnecting(false);
            setMessage({ type: 'error', text: `FB.login error: ${err.message}` });
        }
    };

    const exchangeCodeForToken = async (code: string, sessionInfo?: unknown) => {
        try {
            const res = await api.post('/whatsapp/embedded-signup', sessionInfo ? { code, sessionInfo } : { code });
            await fetchStatus();
            const verified = res.data.verifiedName ? ` (${res.data.verifiedName})` : '';
            setMessage({
                type: 'success',
                text: `WhatsApp connected: ${res.data.displayNumber}${verified}`,
            });
            notify.success('WhatsApp connected');
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err.response?.data?.message || "Oops, we couldn't finish connecting WhatsApp. Let's try again.",
            });
        } finally {
            setConnecting(false);
        }
    };

    // Manual connect fallback — for tenants whose FB Embedded Signup cannot
    // run (ad-blocker, region restrictions, third-party-cookies disabled).
    // Takes the same three values the manual /connect endpoint already accepts.
    const [manualForm, setManualForm] = useState({
        phoneNumberId: '',
        accountId: '',
        accessToken: '',
        displayNumber: '',
    });
    const [manualSubmitting, setManualSubmitting] = useState(false);

    const submitManualConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setManualSubmitting(true);
        setMessage(null);
        try {
            await api.post('/whatsapp/connect', {
                phoneNumberId: manualForm.phoneNumberId.trim(),
                accountId: manualForm.accountId.trim(),
                accessToken: manualForm.accessToken.trim(),
                displayNumber: manualForm.displayNumber.trim() || undefined,
            });
            await fetchStatus();
            setMessage({ type: 'success', text: 'WhatsApp connected with your own details.' });
            notify.success('WhatsApp connected');
            setManualForm({ phoneNumberId: '', accountId: '', accessToken: '', displayNumber: '' });
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err.response?.data?.message || "Those details didn't work. Check them and try again.",
            });
        } finally {
            setManualSubmitting(false);
        }
    };

    const disconnect = async () => {
        setDisconnecting(true);
        try {
            await api.post('/whatsapp/disconnect');
            setStatus({ connected: false });
            setMessage({ type: 'success', text: 'WhatsApp disconnected.' });
            notify.success('WhatsApp disconnected');
        } catch (err) {
            setMessage({ type: 'error', text: "Oops, we couldn't disconnect WhatsApp. Let's try again." });
        } finally {
            setDisconnecting(false);
            setConfirmDisconnect(null);
        }
    };

    const sendTestMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testPhone.trim()) return;

        setSending(true);
        setMessage(null);
        try {
            await api.post('/whatsapp/send-test', {
                to: (testE164 ?? testPhone).replace(/\D/g, ''),
                message: testMessage,
            });
            setMessage({ type: 'success', text: 'Test message sent!' });
            notify.success('Test message sent');
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || "Oops, the message didn't send. Let's try again." });
        } finally {
            setSending(false);
        }
    };

    const steps = [
        { step: 1, title: 'Connect your WhatsApp', desc: 'Link your business number in a few taps', icon: Link2 },
        { step: 2, title: 'A customer messages you', desc: 'They text your business number on WhatsApp', icon: Smartphone },
        { step: 3, title: 'Bookly takes the booking', desc: 'We guide them to pick a time, any hour of the day', icon: Store },
        { step: 4, title: 'Booking confirmed', desc: 'You and your customer both get a confirmation right away', icon: CalendarCheck },
    ];

    return (
        <div className="max-w-3xl space-y-6">
            <PageHeader
                title="WhatsApp"
                subtitle="Connect your WhatsApp so customers can book with you, any time."
            />

            {message && (
                <div
                    role={message.type === 'error' ? 'alert' : 'status'}
                    className={`flex items-center gap-3 rounded-control border px-4 py-3 text-[15px] ${message.type === 'success'
                        ? 'border-success/30 bg-success-soft text-success-fg'
                        : 'border-error/30 bg-error-soft text-error-fg'
                        }`}
                >
                    {message.type === 'success'
                        ? <TickPop key={message.text} size={28} label="Done" className="shrink-0" />
                        : <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
                    }
                    <span className="min-w-0 break-words">{message.text}</span>
                </div>
            )}

            {/* Connection status */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                        <Smartphone className="h-5 w-5 text-primary" aria-hidden />
                        Your connection
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div aria-busy="true" className="space-y-3 py-2">
                            <span className="sr-only">Loading…</span>
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-12 w-12 rounded-control" />
                                <div className="flex-1 space-y-2">
                                    <SkeletonLine width="w-1/2" />
                                    <SkeletonLine width="w-3/4" />
                                </div>
                            </div>
                            <Skeleton className="h-11 w-48 rounded-control" />
                        </div>
                    ) : status?.awaitingCode ? (
                        <div className="space-y-5">
                            <div className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning-soft p-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface text-warning-fg">
                                    <ShieldCheck className="h-5 w-5" aria-hidden />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[15px] font-semibold text-text">
                                        Enter the code we sent to {status.displayNumber}
                                    </p>
                                    <p className="text-small text-warning-fg">
                                        It is a 6-digit code, by SMS. It can take a minute to arrive.
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={verifyHosted} className="space-y-4">
                                <DashboardInput
                                    label="Verification code"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value)}
                                    placeholder="123456"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={8}
                                    required
                                    className="text-[20px] tracking-[0.3em] tabular-nums"
                                />
                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                    <Button type="submit" disabled={otp.trim().length < 4} isLoading={verifying} loadingText="Checking…">
                                        Verify and go live
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={resending}
                                        onClick={() => resendCode('SMS')}
                                    >
                                        Resend SMS
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={resending}
                                        onClick={() => resendCode('VOICE')}
                                    >
                                        Call me instead
                                    </Button>
                                </div>
                            </form>

                            <p className="text-small text-muted">
                                Wrong number?{' '}
                                <button
                                    type="button"
                                    onClick={() => setConfirmDisconnect('restart')}
                                    className="inline-flex min-h-[44px] items-center font-semibold text-primary underline underline-offset-2"
                                >
                                    Start again
                                </button>
                            </p>
                        </div>
                    ) : status?.connected ? (
                        <div className="space-y-6">
                            <div className="flex flex-col gap-3 rounded-control border border-wa-green/30 bg-wa-green/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-wa-green/20 text-wa-teal">
                                        <Smartphone className="h-5 w-5" aria-hidden />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-[17px] font-bold text-text">WhatsApp is connected</h2>
                                        <p className="break-words text-[15px] text-muted">
                                            {status.displayNumber || 'WhatsApp Business'}
                                        </p>
                                    </div>
                                </div>
                                <StatusPill status="connected" className="self-start sm:self-auto" />
                            </div>

                            <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                {[
                                    { label: 'Status', value: 'Active', icon: ShieldCheck },
                                    { label: 'Bookings', value: 'Taking bookings', icon: CalendarCheck },
                                    { label: 'Auto-replies', value: 'On', icon: Sparkles },
                                ].map(({ label, value, icon: Icon }) => (
                                    <StaggerItem
                                        key={label}
                                        className="flex items-center gap-3 rounded-control border border-border bg-surface-2 p-3 sm:flex-col sm:text-center"
                                    >
                                        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                                        <div>
                                            <p className="text-small text-muted">{label}</p>
                                            <p className="text-[15px] font-semibold text-text">{value}</p>
                                        </div>
                                    </StaggerItem>
                                ))}
                            </Stagger>

                            <Button
                                variant="secondary"
                                onClick={() => setConfirmDisconnect('disconnect')}
                                isLoading={disconnecting}
                                className="w-full text-error-fg sm:w-auto"
                            >
                                <Unplug className="h-4 w-4" aria-hidden />
                                Disconnect WhatsApp
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Hosted path — we own the number on Bookly's WABA, so Meta
                                bills us and the tenant never needs a card Meta accepts. */}
                            {status?.hostedAvailable && (
                                <section className="space-y-4 rounded-card border-2 border-primary/30 bg-primary-soft p-5">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-[17px] font-bold text-text">Use a Bookly number</h2>
                                            <span className="rounded-full bg-primary px-2.5 py-0.5 text-[12px] font-semibold text-primary-fg">
                                                Recommended
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[15px] text-muted">
                                            We set the number up for you and handle the WhatsApp fees — you pay us
                                            in one bill, by Mobile Money or card. No Facebook account needed.
                                        </p>
                                    </div>

                                    <form onSubmit={startHosted} className="space-y-3">
                                        <PhoneInput
                                            id="wa-hosted-number"
                                            label="Business phone number"
                                            value={hostedDisplay}
                                            onChange={(display, e164) => {
                                                setHostedDisplay(display);
                                                setHostedForm({
                                                    ...hostedForm,
                                                    localNumber: e164 ? `0${e164.slice(4)}` : display,
                                                });
                                            }}
                                            hint="This number must not already have WhatsApp on a phone. Use a spare SIM, or delete WhatsApp on that number first."
                                            required
                                        />
                                        <Button type="submit" variant="accent" isLoading={hostedSubmitting} loadingText="Sending…" className="w-full sm:w-auto">
                                            Send me a code
                                        </Button>
                                    </form>
                                </section>
                            )}

                            {status?.hostedAvailable && (
                                <div className="flex items-center gap-3" aria-hidden>
                                    <div className="h-px flex-1 bg-border" />
                                    <span className="text-small text-muted">or</span>
                                    <div className="h-px flex-1 bg-border" />
                                </div>
                            )}

                            <div className="flex flex-col gap-3 rounded-control border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface text-muted">
                                        <Link2 className="h-5 w-5" aria-hidden />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-[17px] font-bold text-text">Use your own WhatsApp Business</h2>
                                        <p className="text-[15px] text-muted">
                                            Connect it to start getting bookings on WhatsApp.
                                        </p>
                                    </div>
                                </div>
                                {/* "SDK ready" means nothing to a business owner; only
                                    surface the two states they can act on. */}
                                {sdkFailed ? (
                                    <StatusPill status="failed" label="Blocked" className="self-start sm:self-auto" />
                                ) : !sdkReady ? (
                                    <StatusPill status="pending" label="Getting ready" className="self-start sm:self-auto" />
                                ) : (
                                    <StatusPill status="not_connected" tone="neutral" label="Not connected" className="self-start sm:self-auto" />
                                )}
                            </div>

                            {sdkFailed && (
                                <div className="rounded-control border border-warning/40 bg-warning-soft p-4">
                                    <div className="flex items-start gap-3">
                                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-fg" aria-hidden />
                                        <div className="min-w-0">
                                            <p className="text-[15px] font-semibold text-text">Facebook could not load</p>
                                            <p className="mt-1 text-small text-warning-fg">
                                                This usually happens when an ad-blocker or browser extension is blocking{' '}
                                                <code className="break-all rounded bg-surface px-1.5 py-0.5 text-[13px] text-text">connect.facebook.net</code>
                                            </p>
                                            <ul className="ml-5 mt-2 list-disc space-y-0.5 text-small text-text">
                                                <li>Turn off ad-blockers for this page</li>
                                                <li>Try a private (incognito) window</li>
                                                <li>Use a different browser</li>
                                            </ul>
                                            <Button variant="secondary" size="sm" onClick={retrySDK} className="mt-3">
                                                Try again
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <Button
                                onClick={launchWhatsAppSignup}
                                disabled={!sdkReady}
                                isLoading={connecting}
                                loadingText="Connecting…"
                                className={`w-full sm:w-auto ${WA_BUTTON}`}
                            >
                                <Smartphone className="h-5 w-5" aria-hidden />
                                Connect WhatsApp Business
                            </Button>

                            {/* Manual fallback — collapsed by default. For tenants
                                where Embedded Signup can't run (ad-blocker, region,
                                third-party-cookie disabled). */}
                            <details className="group rounded-control border border-border p-4">
                                <summary className="flex min-h-[44px] cursor-pointer items-center text-[15px] font-semibold text-text group-open:mb-3">
                                    Advanced: connect with your own Meta details
                                </summary>
                                <p className="mb-3 text-small text-muted">
                                    Only needed if the button above does not work for you. Your
                                    developer or IT person can find these values in Meta Business
                                    Manager (WhatsApp → API Setup, and Business Settings → System Users).
                                </p>
                                <form onSubmit={submitManualConnect} className="space-y-3">
                                    <DashboardInput
                                        label="Phone Number ID"
                                        value={manualForm.phoneNumberId}
                                        onChange={(e) =>
                                            setManualForm({ ...manualForm, phoneNumberId: e.target.value })
                                        }
                                        required
                                    />
                                    <DashboardInput
                                        label="WhatsApp Business Account ID"
                                        value={manualForm.accountId}
                                        onChange={(e) =>
                                            setManualForm({ ...manualForm, accountId: e.target.value })
                                        }
                                        required
                                    />
                                    <DashboardInput
                                        label="System User Access Token"
                                        type="password"
                                        value={manualForm.accessToken}
                                        onChange={(e) =>
                                            setManualForm({ ...manualForm, accessToken: e.target.value })
                                        }
                                        required
                                    />
                                    <DashboardInput
                                        label="Display phone number (optional, e.g. +233 24 412 3456)"
                                        value={manualForm.displayNumber}
                                        onChange={(e) =>
                                            setManualForm({ ...manualForm, displayNumber: e.target.value })
                                        }
                                    />
                                    <Button
                                        type="submit"
                                        variant="secondary"
                                        isLoading={manualSubmitting}
                                        loadingText="Connecting…"
                                    >
                                        Connect with these details
                                    </Button>
                                </form>
                            </details>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* How it works */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Zap className="h-5 w-5 text-primary" aria-hidden />
                        How it works
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Stagger as="ol" className="space-y-2">
                        {steps.map(({ step, title, desc, icon: Icon }) => (
                            <StaggerItem
                                as="li"
                                key={step}
                                className="flex items-center gap-4 rounded-control p-3 transition-colors duration-ui hover:bg-surface-2"
                            >
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                                    <Icon className="h-5 w-5" aria-hidden />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[15px] font-semibold text-text">{title}</p>
                                    <p className="text-small text-muted">{desc}</p>
                                </div>
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold tabular-nums text-muted" aria-label={`Step ${step}`}>
                                    {step}
                                </span>
                            </StaggerItem>
                        ))}
                    </Stagger>
                </CardContent>
            </Card>

            {/* Test message (only when connected) */}
            {status?.connected && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-primary" aria-hidden />
                            Send a test message
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={sendTestMessage} className="space-y-4">
                            <PhoneInput
                                id="wa-test-phone"
                                label="Send it to"
                                value={testPhone}
                                onChange={(display, e164) => { setTestPhone(display); setTestE164(e164); }}
                                hint="Try your own number to see what customers get."
                            />
                            <Textarea
                                id="wa-test-message"
                                label="Message"
                                value={testMessage}
                                onChange={(e) => setTestMessage(e.target.value)}
                                rows={3}
                            />
                            <Button
                                type="submit"
                                disabled={!testPhone}
                                isLoading={sending}
                                loadingText="Sending…"
                                className="w-full sm:w-auto"
                            >
                                <Send className="h-4 w-4" aria-hidden />
                                Send test
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            )}

            <ConfirmDialog
                isOpen={confirmDisconnect !== null}
                onClose={() => setConfirmDisconnect(null)}
                onConfirm={disconnect}
                title={confirmDisconnect === 'restart' ? 'Start again with a new number?' : 'Disconnect WhatsApp?'}
                description={confirmDisconnect === 'restart'
                    ? 'We will cancel this number so you can enter a different one.'
                    : 'Bookly will stop replying to your customers on WhatsApp until you connect again.'}
                confirmLabel={confirmDisconnect === 'restart' ? 'Start again' : 'Disconnect'}
                isLoading={disconnecting}
            />
        </div>
    );
}
