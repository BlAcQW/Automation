import { BooklyIcon } from '@/components/primitives/bookly-icon';

export const metadata = { title: 'Offline | Bookly' };

/**
 * Branded offline fallback. The service worker serves this for navigation
 * requests that fail while the device has no connection.
 */
export default function OfflinePage() {
    return (
        <main className="relative isolate flex min-h-screen items-center justify-center bg-ink-950 px-6 text-ink-50">
            <div className="fs-hero-grid" aria-hidden />
            <div className="max-w-sm text-center">
                <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-[6px] bg-ink-900 shadow-[0_14px_30px_-22px_rgba(20,26,22,0.45)] ring-1 ring-ink-700/60">
                    <BooklyIcon size="lg" />
                </div>
                <p className="font-mono text-[11px] text-ink-300">/offline/</p>
                <h1 className="mt-3 text-[clamp(36px,9vw,52px)] font-normal leading-[0.98] tracking-[-0.05em] text-ink-50">
                    You&apos;re offline
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
                    Bookly needs a connection to load this screen. Check your network and try
                    again. Your work is safe.
                </p>
            </div>
        </main>
    );
}
