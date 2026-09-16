'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Download, X, Share } from 'lucide-react';
import { BooklyIcon } from '@/components/primitives/bookly-icon';

/** The non-standard `beforeinstallprompt` event (Chromium browsers). */
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'bf-install-dismissed';
const SEEN_KEY = 'bf-install-seen';

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
}

/**
 * Install-to-home-screen prompt.
 *
 * Shown on the Overview page only, and only from the second visit: a person
 * who signed up thirty seconds ago has no reason to install anything yet,
 * and a banner that follows them onto every screen (covering the Save
 * button on Settings, the search box on Customers) reads as an ad. On
 * Chromium it captures `beforeinstallprompt` for one-tap install; on iOS it
 * explains the Share → Add to Home Screen path. Dismissal sticks.
 */
export function InstallPrompt() {
    const pathname = usePathname();
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [showIosHint, setShowIosHint] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isStandalone()) return;
        let seen = 0;
        try {
            if (localStorage.getItem(DISMISS_KEY) === '1') return;
            seen = Number(localStorage.getItem(SEEN_KEY) ?? '0');
            localStorage.setItem(SEEN_KEY, String(seen + 1));
        } catch {
            return;
        }
        if (seen < 1) return;

        const onPrompt = (e: Event) => {
            e.preventDefault();
            setDeferred(e as BeforeInstallPromptEvent);
            setVisible(true);
        };
        window.addEventListener('beforeinstallprompt', onPrompt);

        // iOS Safari never fires `beforeinstallprompt`; detect it directly.
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
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
        setVisible(false);
    };

    const install = async () => {
        if (!deferred) return;
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') {
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
        }
        setDeferred(null);
        setVisible(false);
    };

    if (!visible || pathname !== '/dashboard') return null;

    return (
        <div className="fixed inset-x-3 z-50 bottom-24 lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm">
            <div className="flex items-start gap-3 rounded-2xl border border-ink-700 bg-ink-900 p-4 shadow-card-lg">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-1000 ring-1 ring-ink-700">
                    <BooklyIcon className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-50">
                        Put Bookly on your home screen
                    </p>
                    {showIosHint ? (
                        <p className="mt-0.5 text-[13px] leading-snug text-ink-300">
                            Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" aria-label="Share" /> at the
                            bottom of Safari, then <span className="font-medium text-ink-100">Add to Home Screen</span>.
                            It opens like an app.
                        </p>
                    ) : (
                        <p className="mt-0.5 text-[13px] leading-snug text-ink-300">
                            Opens like an app, no browser bar.
                        </p>
                    )}
                    {!showIosHint && (
                        <button
                            onClick={install}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-bookly-emerald-500 px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-bookly-emerald-400 transition-colors"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Install
                        </button>
                    )}
                </div>
                <button
                    onClick={dismiss}
                    aria-label="Not now"
                    className="shrink-0 rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-50 transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
