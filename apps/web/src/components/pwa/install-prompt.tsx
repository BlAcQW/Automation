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
            <div className="flex items-start gap-3 rounded-2xl bg-forest-night p-4 text-forest-cream shadow-[0_30px_50px_-28px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)] dark:bg-forest-card dark:shadow-[0_0_0_1px_rgba(236,235,225,0.08),0_30px_50px_-28px_rgba(0,0,0,0.8)]">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest-paper">
                    <BooklyIcon size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium tracking-[-0.02em] text-forest-cream">
                        Put Bookly on your home screen
                    </p>
                    {showIosHint ? (
                        <p className="mt-0.5 text-[13px] leading-snug text-forest-cream/65">
                            Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" aria-label="Share" /> at the
                            bottom of Safari, then <span className="font-medium text-forest-cream">Add to Home Screen</span>.
                            It opens like an app.
                        </p>
                    ) : (
                        <p className="mt-0.5 text-[13px] leading-snug text-forest-cream/65">
                            Opens like an app, no browser bar.
                        </p>
                    )}
                    {!showIosHint && (
                        <button
                            onClick={install}
                            className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded bg-forest-cream px-3.5 text-[13px] font-medium text-forest-night hover:bg-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-glow"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Install
                        </button>
                    )}
                </div>
                <button
                    onClick={dismiss}
                    aria-label="Not now"
                    className="shrink-0 rounded p-1.5 text-forest-cream/60 hover:bg-white/[0.08] hover:text-forest-cream transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-glow"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
