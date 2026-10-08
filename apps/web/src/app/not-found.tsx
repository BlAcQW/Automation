import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { SupportLinks } from '@/components/support-links';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
    return (
        <main id="main" className="relative isolate flex min-h-screen items-center bg-ink-950 px-4 py-12 text-ink-50 sm:px-8">
            <div className="fs-hero-grid" aria-hidden />
            <div className="mx-auto w-full max-w-xl">
                <Link href="/" className="inline-block">
                    <BooklyWordmark size="lg" />
                </Link>
                <p className="mt-14 flex items-center gap-2 font-mono text-[11px] text-ink-300">
                    <Compass className="h-3.5 w-3.5" aria-hidden />
                    /404/
                </p>
                <h1 className="mt-4 max-w-[14ch] text-[clamp(40px,7vw,72px)] font-normal leading-[0.98] tracking-[-0.05em] text-ink-50">
                    That page is not here
                </h1>
                <p className="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-ink-300">
                    The link may be old, or the address has a typo. Nothing of yours has changed.
                </p>
                <div className="mt-9 flex flex-col gap-2 sm:flex-row">
                    <Link href="/dashboard" className="fs-btn fs-btn--lg fs-btn--brand">
                        Go to my dashboard
                    </Link>
                    <Link href="/" className="fs-btn fs-btn--lg fs-btn--ghost text-ink-50">
                        Home
                    </Link>
                </div>
                <p className="mt-12 border-t border-ink-700/60 pt-5 text-[13px] text-ink-300">
                    Followed a link from us and landed here? <SupportLinks inline topic="a link in Bookly is broken" />
                </p>
            </div>
        </main>
    );
}
