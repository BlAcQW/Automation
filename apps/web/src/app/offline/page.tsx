import { BooklyIcon } from '@/components/primitives/bookly-icon';

export const metadata = { title: 'Offline — Bookly' };

/**
 * Branded offline fallback. The service worker serves this for navigation
 * requests that fail while the device has no connection.
 */
export default function OfflinePage() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-ink-950 px-6">
            <div className="text-center max-w-sm">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-900 ring-1 ring-bookly-emerald-500/20 shadow-bookly-soft">
                    <BooklyIcon className="h-11 w-11" />
                </div>
                <h1 className="font-display text-h2 text-ink-50">You&apos;re offline</h1>
                <p className="mt-2 text-body-sm text-ink-300">
                    Bookly needs a connection to load this screen. Check your network and try
                    again — your work is safe.
                </p>
            </div>
        </main>
    );
}
