'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Download, X, Share } from 'lucide-react';
import { BrandLogo, Button } from '@bookingflow/ui';

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
        <div
            className="fixed inset-x-4 bottom-24 z-50 lg:bottom-6 lg:left-auto lg:right-6 lg:max-w-sm"
        >
            <div className="overflow-hidden rounded-card border border-border bg-surface text-text shadow-card-lg">
                {/* Thin brand stripe: green with a gold tip, no logo art. */}
                <div className="flex h-1.5" aria-hidden>
                    <span className="flex-1 bg-primary" />
                    <span className="w-12 bg-accent" />
                </div>
                <div className="flex items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                        <BrandLogo size="sm" />
                        <p id="install-prompt-title" className="mt-2 text-base font-semibold text-text">
                            Put Bookly on your home screen
                        </p>
                        {showIosHint ? (
                            <p className="mt-1 text-[15px] leading-relaxed text-muted">
                                Tap <Share className="-mt-0.5 inline h-4 w-4" aria-label="Share" /> at the bottom of
                                Safari, then <span className="font-semibold text-text">Add to Home Screen</span>. It opens
                                like an app.
                            </p>
                        ) : (
                            <p className="mt-1 text-[15px] leading-relaxed text-muted">
                                Open your shop in one tap, like an app. No browser bar.
                            </p>
                        )}
                        {!showIosHint && (
                            <Button onClick={install} size="sm" className="mt-3">
                                <Download className="h-4 w-4" aria-hidden />
                                Install
                            </Button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Not now"
                        className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-ui hover:bg-text/[0.06] hover:text-text"
                    >
                        <X className="h-5 w-5" aria-hidden />
                    </button>
                </div>
            </div>
        </div>
    );
}
