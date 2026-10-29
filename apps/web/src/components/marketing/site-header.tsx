import Link from 'next/link';
import { ChevronRight, Menu, X } from 'lucide-react';
import { cx as cn } from '@/components/marketing/cx';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { SiteLogo } from './site-logo';
import { ButtonLink, Container, SignupLink } from './primitives';
import styles from './marketing.module.css';

export const NAV_LINKS = [
    { href: '/features', label: 'What it does' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/faq', label: 'Questions' },
    { href: '/about', label: 'About' },
    { href: '/support', label: 'Support' },
] as const;

/**
 * Public site header. Server-rendered; the mobile menu is a native
 * <details> disclosure, so it works before (and without) hydration.
 * `current` marks the active link with aria-current.
 */
export function SiteHeader({ current }: { current?: string }) {
    return (
        <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
            <Container className="flex h-16 items-center justify-between gap-3">
                <SiteLogo />

                <nav aria-label="Main" className="hidden lg:block">
                    <ul className="flex items-center gap-1">
                        {NAV_LINKS.map((l) => (
                            <li key={l.href}>
                                <Link
                                    href={l.href}
                                    aria-current={current === l.href ? 'page' : undefined}
                                    className={cn(
                                        'inline-flex min-h-[44px] items-center rounded-control px-3 text-[15px] font-medium transition-colors duration-ui',
                                        current === l.href ? 'text-primary' : 'text-text/80 hover:bg-text/[0.05] hover:text-text',
                                    )}
                                >
                                    {l.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div className="flex items-center gap-1.5 sm:gap-2">
                    <ThemeToggle />
                    <ButtonLink href="/login" variant="ghost" size="md" className="hidden sm:inline-flex">
                        Log in
                    </ButtonLink>
                    <SignupLink variant="primary" size="md" className="px-4" />

                    <details className={cn('relative lg:hidden', styles.menu)}>
                        <summary
                            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-control border border-border bg-surface text-text"
                            aria-label="Menu"
                        >
                            <Menu className={cn('h-5 w-5', styles.menuIconOpen)} aria-hidden />
                            <X className={cn('h-5 w-5', styles.menuIconClose)} aria-hidden />
                        </summary>
                        <div
                            className={cn(
                                'absolute right-0 top-[calc(100%+8px)] w-[min(18rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-2 shadow-card-lg',
                                styles.menuPanel,
                            )}
                        >
                            <nav aria-label="Main (mobile)">
                                <ul>
                                    {NAV_LINKS.map((l) => (
                                        <li key={l.href}>
                                            <Link
                                                href={l.href}
                                                aria-current={current === l.href ? 'page' : undefined}
                                                className="flex min-h-[48px] items-center justify-between rounded-control px-3 text-body font-medium text-text hover:bg-surface-2"
                                            >
                                                {l.label}
                                                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                                            </Link>
                                        </li>
                                    ))}
                                    <li className="mt-1 border-t border-border pt-1">
                                        <Link
                                            href="/login"
                                            className="flex min-h-[48px] items-center justify-between rounded-control px-3 text-body font-medium text-text hover:bg-surface-2"
                                        >
                                            Log in
                                            <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                                        </Link>
                                    </li>
                                </ul>
                            </nav>
                        </div>
                    </details>
                </div>
            </Container>
        </header>
    );
}
