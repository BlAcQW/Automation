import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { AwningDivider, BrandLogo } from '@bookingflow/ui';

export const metadata: Metadata = {
    title: "You're offline",
    robots: { index: false, follow: false },
};

/**
 * Branded offline fallback. The service worker serves this for navigation
 * requests that fail while the device has no connection. Server-rendered and
 * fully visible without JS (it may be the only thing that loads).
 */
export default function OfflinePage() {
    return (
        <main id="main" className="flex min-h-screen flex-col bg-bg text-text">
            <AwningDivider size="sm" />
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
                <BrandLogo size="md" />
                <div className="mt-10 w-full max-w-sm rounded-card-lg border border-border bg-surface p-6 shadow-card sm:p-8">
                    <div
                        aria-hidden
                        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft text-warning-fg"
                    >
                        <WifiOff className="h-8 w-8" />
                    </div>
                    <h1 className="mt-5 font-display text-page-title text-text">You&apos;re offline</h1>
                    <p className="mt-3 text-body leading-relaxed text-muted">
                        We can&apos;t reach the internet right now. Check your data or Wi-Fi, then reload this page.
                        Don&apos;t worry, your work is safe.
                    </p>
                </div>
            </div>
        </main>
    );
}
