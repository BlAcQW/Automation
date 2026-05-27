'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';
import {
    MessageCircle, Check, AlertCircle, Loader2,
    Smartphone, Send, Unplug, Zap, Bot, CalendarCheck, ShieldCheck, Wifi, WifiOff
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DashboardInput } from '@/components/ui/input';

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
}

export default function WhatsAppSetupPage() {
    const { tenant } = useAuth();
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [testPhone, setTestPhone] = useState('');
    const [testMessage, setTestMessage] = useState('Hello! This is a test message from Bookly.');
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    const [sdkFailed, setSdkFailed] = useState(false);

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
            setMessage({ type: 'error', text: 'Failed to load WhatsApp status.' });
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
                version: 'v18.0'
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
            setMessage({ type: 'error', text: 'Facebook SDK blocked. Please disable ad-blockers for this page and try again.' });
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
            setMessage({ type: 'error', text: 'Facebook SDK not loaded. Please disable ad-blockers and refresh the page.' });
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

        try {
            window.FB.login(
                function (response: any) {
                    if (response.authResponse) {
                        exchangeCodeForToken(response.authResponse.code);
                    } else {
                        setConnecting(false);
                        setMessage({ type: 'error', text: 'WhatsApp signup was cancelled or failed.' });
                    }
                },
                {
                    config_id: configId,
                    response_type: 'code',
                    override_default_response_type: true,
                    extras: {
                        setup: {},
                        featureType: '',
                        sessionInfoVersion: '2',
                    }
                }
            );
        } catch (err: any) {
            setConnecting(false);
            setMessage({ type: 'error', text: `FB.login error: ${err.message}` });
        }
    };

    const exchangeCodeForToken = async (code: string) => {
        try {
            const res = await api.post('/whatsapp/embedded-signup', { code });
            await fetchStatus();
            const verified = res.data.verifiedName ? ` (${res.data.verifiedName})` : '';
            setMessage({
                type: 'success',
                text: `WhatsApp connected: ${res.data.displayNumber}${verified}`,
            });
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err.response?.data?.message || 'Failed to complete WhatsApp signup',
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
            setMessage({ type: 'success', text: 'WhatsApp connected via manual values.' });
            setManualForm({ phoneNumberId: '', accountId: '', accessToken: '', displayNumber: '' });
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err.response?.data?.message || 'Manual WhatsApp connect failed',
            });
        } finally {
            setManualSubmitting(false);
        }
    };

    const disconnect = async () => {
        if (!confirm('Disconnect WhatsApp? This will stop all bot conversations.')) return;

        setDisconnecting(true);
        try {
            await api.post('/whatsapp/disconnect');
            setStatus({ connected: false });
            setMessage({ type: 'success', text: 'WhatsApp disconnected.' });
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to disconnect WhatsApp' });
        } finally {
            setDisconnecting(false);
        }
    };

    const sendTestMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testPhone.trim()) return;

        setSending(true);
        setMessage(null);
        try {
            await api.post('/whatsapp/send-test', {
                to: testPhone.replace(/\D/g, ''),
                message: testMessage,
            });
            setMessage({ type: 'success', text: 'Test message sent!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to send message' });
        } finally {
            setSending(false);
        }
    };

    const steps = [
        {
            step: 1,
            title: 'Connect WhatsApp Business',
            desc: 'Link your Meta Business account via the official signup flow',
            icon: Smartphone,
            color: 'text-emerald-600 dark:text-emerald-400',
            bg: 'bg-emerald-50 dark:bg-emerald-900/30',
        },
        {
            step: 2,
            title: 'Customer messages you',
            desc: 'They text your business number on WhatsApp',
            icon: MessageCircle,
            color: 'text-blue-600 dark:text-blue-400',
            bg: 'bg-blue-50 dark:bg-blue-900/30',
        },
        {
            step: 3,
            title: 'AI handles booking',
            desc: 'The bot guides them through scheduling automatically',
            icon: Bot,
            color: 'text-purple-600 dark:text-purple-400',
            bg: 'bg-purple-50 dark:bg-purple-900/30',
        },
        {
            step: 4,
            title: 'Booking confirmed',
            desc: 'Both parties receive a confirmation instantly',
            icon: CalendarCheck,
            color: 'text-amber-600 dark:text-amber-400',
            bg: 'bg-amber-50 dark:bg-amber-900/30',
        },
    ];

    return (
        <div className="space-y-6 max-w-3xl animate-in fade-in duration-500">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    WhatsApp Integration
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">
                    Connect your WhatsApp Business account to receive bookings
                </p>
            </div>

            {/* Alert Banner */}
            {message && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${message.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300'
                        }`}
                >
                    {message.type === 'success'
                        ? <Check className="w-4 h-4 flex-shrink-0" />
                        : <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    }
                    <span>{message.text}</span>
                </motion.div>
            )}

            {/* Connection Status Card */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Smartphone className="w-5 h-5 text-emerald-500" />
                        Connection Status
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center gap-3 py-4">
                            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                            <span className="text-slate-500 dark:text-slate-400">Checking connection...</span>
                        </div>
                    ) : status?.connected ? (
                        <div className="space-y-6">
                            {/* Connected Banner */}
                            <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                        <Wifi className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm">WhatsApp Connected</p>
                                        <p className="text-emerald-700 dark:text-emerald-300 text-xs">
                                            {status.displayNumber || 'WhatsApp Business'}
                                        </p>
                                    </div>
                                </div>
                                <Badge variant="default" dot pulse>Connected</Badge>
                            </div>

                            {/* Quick Stats */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {[
                                    { label: 'Status', value: 'Active', icon: ShieldCheck, color: 'text-emerald-500' },
                                    { label: 'Bot', value: 'Running', icon: Bot, color: 'text-blue-500' },
                                    { label: 'Auto-Reply', value: 'On', icon: Zap, color: 'text-amber-500' },
                                ].map(({ label, value, icon: Icon, color }, i) => (
                                    <motion.div
                                        key={label}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.1 }}
                                        className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700"
                                    >
                                        <Icon className={`w-5 h-5 mx-auto mb-1.5 ${color}`} />
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
                                    </motion.div>
                                ))}
                            </div>

                            <Button
                                variant="destructive"
                                onClick={disconnect}
                                disabled={disconnecting}
                                className="w-full sm:w-auto"
                            >
                                {disconnecting
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <Unplug className="w-4 h-4" />
                                }
                                Disconnect WhatsApp
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Not Connected Banner */}
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-600">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                                        <WifiOff className="w-5 h-5 text-slate-500" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-slate-200 text-sm">Not Connected</p>
                                        <p className="text-slate-500 dark:text-slate-400 text-xs">
                                            Connect to start receiving bookings via WhatsApp
                                        </p>
                                    </div>
                                </div>
                                {sdkReady ? (
                                    <Badge variant="default" dot>SDK Ready</Badge>
                                ) : sdkFailed ? (
                                    <Badge variant="red" dot>SDK Blocked</Badge>
                                ) : (
                                    <Badge variant="yellow" dot pulse>Loading SDK...</Badge>
                                )}
                            </div>

                            {/* SDK Failed Warning */}
                            {sdkFailed && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl"
                                >
                                    <div className="flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-medium text-amber-900 dark:text-amber-200 text-sm">Facebook SDK could not load</p>
                                            <p className="text-amber-700 dark:text-amber-300 text-xs mt-1">
                                                This usually happens when an ad-blocker or browser extension is blocking{' '}
                                                <code className="bg-amber-200/50 dark:bg-amber-800/50 px-1.5 py-0.5 rounded text-xs">connect.facebook.net</code>
                                            </p>
                                            <ul className="list-disc ml-5 mt-2 text-amber-700 dark:text-amber-300 text-xs space-y-0.5">
                                                <li>Disable ad-blockers for this page</li>
                                                <li>Try in an Incognito/Private window</li>
                                                <li>Use a different browser</li>
                                            </ul>
                                            <Button variant="outline" size="sm" onClick={retrySDK} className="mt-3">
                                                Retry SDK
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {/* Connect Button */}
                            <Button
                                onClick={launchWhatsAppSignup}
                                disabled={connecting || !sdkReady}
                                className="w-full sm:w-auto bg-[#25D366] hover:bg-[#20bd5a] text-white border-none shadow-lg shadow-[#25D366]/25 hover:shadow-[#25D366]/40 disabled:shadow-none"
                            >
                                {connecting ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <MessageCircle className="w-5 h-5" />
                                )}
                                Connect WhatsApp Business
                            </Button>

                            {/* Manual fallback — collapsed by default. For tenants
                                where Embedded Signup can't run (ad-blocker, region,
                                third-party-cookie disabled). */}
                            <details className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 p-4 group">
                                <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 group-open:mb-4">
                                    Connect manually instead
                                </summary>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                    Paste values from Meta Business Manager. The phone number ID and
                                    WABA ID are visible under WhatsApp → API Setup. Create a permanent
                                    System User access token under Business Settings → Users → System Users.
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
                                        label="Display Phone Number (optional, e.g. +1 555 0100)"
                                        value={manualForm.displayNumber}
                                        onChange={(e) =>
                                            setManualForm({ ...manualForm, displayNumber: e.target.value })
                                        }
                                    />
                                    <Button
                                        type="submit"
                                        variant="outline"
                                        size="sm"
                                        disabled={manualSubmitting}
                                    >
                                        {manualSubmitting ? 'Connecting…' : 'Connect with these values'}
                                    </Button>
                                </form>
                            </details>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* How It Works */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Zap className="w-5 h-5 text-amber-500" />
                        How it works
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {steps.map(({ step, title, desc, icon: Icon, color, bg }, index) => (
                            <motion.div
                                key={step}
                                initial={{ opacity: 0, x: -15 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="flex items-center gap-4 group p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                            >
                                <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110`}>
                                    <Icon className={`w-5 h-5 ${color}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-900 dark:text-white text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                        {title}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
                                </div>
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-400 dark:text-slate-500">
                                    {step}
                                </span>
                            </motion.div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Test Message (only when connected) */}
            {status?.connected && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                <Send className="w-5 h-5 text-blue-500" />
                                Send Test Message
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={sendTestMessage} className="space-y-4">
                                <DashboardInput
                                    label="Phone Number (with country code)"
                                    type="tel"
                                    value={testPhone}
                                    onChange={(e) => setTestPhone(e.target.value)}
                                    placeholder="+1234567890"
                                />
                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                        Message
                                    </label>
                                    <textarea
                                        value={testMessage}
                                        onChange={(e) => setTestMessage(e.target.value)}
                                        rows={3}
                                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 hover:border-slate-300 dark:hover:border-slate-500 transition-all"
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    disabled={sending || !testPhone}
                                >
                                    {sending
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <Send className="w-4 h-4" />
                                    }
                                    Send Test
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </motion.div>
            )}
        </div>
    );
}
