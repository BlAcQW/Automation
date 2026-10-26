import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { SupportLinks } from '@/components/support-links';
import { ButtonLink } from '@/components/marketing/primitives';
import { StatusPage } from '@/components/marketing/status-page';

export const metadata: Metadata = {
    title: 'Page not found',
    robots: { index: false, follow: true },
};

const POPULAR = [
    ['What Bookly does', '/features'],
    ['Pricing', '/pricing'],
    ['Questions', '/faq'],
    ['Support', '/support'],
] as const;

export default function NotFound() {
    return (
        <StatusPage>
            <p className="inline-flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1 text-small font-semibold text-warning-fg">
                <SearchX className="h-4 w-4" aria-hidden />
                Error 404
            </p>
            <h1 className="mt-4 font-display text-page-title text-text">This page isn&apos;t here.</h1>
            <p className="mt-3 text-body text-muted">
                The link may be old, or the address has a typo. Nothing of yours has changed.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/">Go to the home page</ButtonLink>
                <ButtonLink href="/dashboard" variant="secondary">Open my dashboard</ButtonLink>
            </div>
            <nav aria-label="Popular pages" className="mt-8 border-t border-border pt-6">
                <h2 className="text-small font-semibold text-text">Or try one of these</h2>
                <ul className="mt-2 flex flex-wrap gap-x-5">
                    {POPULAR.map(([label, href]) => (
                        <li key={href}>
                            <Link href={href} className="inline-flex min-h-[44px] items-center text-body font-medium text-primary underline underline-offset-4">
                                {label}
                            </Link>
                        </li>
                    ))}
                </ul>
            </nav>
            <p className="mt-4 text-small text-muted">
                Followed a link from us and landed here? <SupportLinks inline topic="a link in Bookly is broken" />
            </p>
        </StatusPage>
    );
}
