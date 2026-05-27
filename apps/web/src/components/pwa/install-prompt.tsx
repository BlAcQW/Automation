'use client';

import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { BooklyIcon } from '@/components/primitives/bookly-icon';

/** The non-standard `beforeinstallprompt` event (Chromium browsers). */
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'bf-install-dismissed';

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
}

/**
 * Install-to-home-screen prompt. On Chromium it captures `beforeinstallprompt`
 * and offers a one-tap Install button; on iOS (no such event) it shows an
 * "Add to Home Screen" hint. Dismissal is remembered in localStorage.
 */
export function InstallPrompt() {
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [showIosHint, setShowIosHint] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isStandalone() || localStorage.getItem(DISMISS_KEY) === '1') return;

        const onPrompt = (e: Event) => {
            e.preventDefault();
            setDeferred(e as BeforeInstallPromptEvent);
            setVisible(true);
        };
        window.addEventListener('beforeinstallprompt', onPrompt);

        // iOS Safari never fires `beforeinstallprompt` — detect it directly.
        const ua = window.navigator.userAgent;
        const isIos = /iphone|ipad|ipod/i.test(ua);
        const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
        if (isIos && isSafari) {
            setShowIosHint(true);
            setVisible(true);
        }

        return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }, []);

    const dismiss = () => {
        localStorage.setItem(DISMISS_KEY, '1');
        setVisible(false);
    };

    const install = async () => {
        if (!deferred) return;
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') localStorage.setItem(DISMISS_KEY, '1');
        setDeferred(null);
        setVisible(false);
    };

    if (!visible) return null;

    return (
        <div className="fixed inset-x-3 z-50 bottom-24 lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-card-lg">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-1000/80 ring-1 ring-bookly-emerald-500/20">
                    <BooklyIcon className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        Install Bookly
                    </p>
                    {showIosHint ? (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> then{' '}
                            <span className="font-medium">Add to Home Screen</span> for the full-screen app.
                        </p>
                    ) : (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Add it to your home screen for quick, full-screen access.
                        </p>
                    )}
                    {!showIosHint && (
                        <button
                            onClick={install}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Install
                        </button>
                    )}
                </div>
                <button
                    onClick={dismiss}
                    aria-label="Dismiss"
                    className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
