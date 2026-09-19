import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { SupportLinks } from '@/components/support-links';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
    return (
        <main id="main" className="min-h-screen bg-ink-950 text-ink-50 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <Link href="/" className="inline-block">
                    <BooklyWordmark size="lg" />
                </Link>
                <div className="mt-10 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-bookly-emerald-500/10 text-bookly-emerald-400">
                    <Compass className="h-6 w-6" aria-hidden />
                </div>
                <h1 className="mt-5 font-display text-display-md text-ink-50">That page is not here</h1>
                <p className="mt-3 text-body text-ink-300 max-w-[42ch]">
                    The link may be old, or the address has a typo. Nothing of yours has changed.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                    <Link
                        href="/dashboard"
                        className="inline-flex h-12 items-center justify-center rounded-xl bg-bookly-emerald-500 px-6 text-[15px] font-medium text-on-accent hover:bg-bookly-emerald-400 transition-colors"
                    >
                        Go to my dashboard
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] font-medium text-ink-50 hover:border-ink-600 hover:bg-ink-900/60 transition-colors"
                    >
                        Home
                    </Link>
                </div>
                <p className="mt-10 text-body-sm text-ink-300">
                    Followed a link from us and landed here? <SupportLinks inline topic="a link in Bookly is broken" />
                </p>
            </div>
        </main>
    );
}
