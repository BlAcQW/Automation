import Link from 'next/link';
import { Check, ChevronRight } from 'lucide-react';
import { AwningDivider } from '@bookingflow/ui';
import { cx as cn } from './cx';
import type { AnalyticsEvent } from '@/lib/analytics';
import styles from './marketing.module.css';
import { RotatingChannel } from '@/components/brand/rotating-channel';

/**
 * Server-rendered building blocks for the public site. Everything here is
 * static HTML + Tailwind on the brand tokens, so pages stay SSG and ship
 * almost no JS.
 */

/* ------------------------------------------------------------------ */
/* Links that look like buttons                                        */
/* ------------------------------------------------------------------ */

export type ButtonLinkVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'inverse' | 'inverse-outline';

const BUTTON_BASE =
    'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[background-color,box-shadow,color,border-color,transform] duration-ui ease-brand-out active:scale-[0.97] motion-reduce:active:scale-100 [&_svg]:shrink-0';

const BUTTON_VARIANTS: Record<ButtonLinkVariant, string> = {
    primary: 'bg-primary text-primary-fg shadow-soft hover:bg-primary-hover',
    accent: 'bg-accent text-accent-fg shadow-soft hover:bg-accent-hover',
    secondary: 'border border-border bg-surface text-text hover:border-text/30 hover:bg-surface-2',
    ghost: 'text-text hover:bg-text/[0.06]',
    // On green / charcoal bands.
    inverse: 'bg-cream text-charcoal shadow-soft hover:bg-white',
    'inverse-outline': 'border border-cream/50 text-cream hover:border-cream hover:bg-cream/10',
};

const BUTTON_SIZES = {
    md: 'min-h-[44px] px-5 text-[15px]',
    lg: 'min-h-[48px] px-6 text-base',
    xl: 'min-h-[56px] px-7 text-[17px]',
} as const;

export type ButtonLinkSize = keyof typeof BUTTON_SIZES;

/**
 * Candidate for packages/ui: a `ButtonLink`. The shared Button only renders
 * <button>, and `buttonVariants` lives in a 'use client' module that a server
 * page cannot call.
 */
export function ButtonLink({
    href, children, variant = 'primary', size = 'lg', className, event,
}: {
    href: string;
    children: React.ReactNode;
    variant?: ButtonLinkVariant;
    size?: ButtonLinkSize;
    className?: string;
    /** Plausible goal reported on click (see lib/analytics.ts). */
    event?: AnalyticsEvent;
}) {
    const cls = cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
    if (/^(https?:|mailto:)/.test(href)) {
        const newTab = href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {};
        return (
            <a href={href} className={cls} data-analytics={event} {...newTab}>
                {children}
            </a>
        );
    }
    return (
        <Link href={href} className={cls} data-analytics={event}>
            {children}
        </Link>
    );
}

/** The sign-up CTA. Always reported as the `Signup` goal. */
export function SignupLink({
    children = 'Start free', variant = 'accent', size = 'lg', className,
}: {
    children?: React.ReactNode; variant?: ButtonLinkVariant; size?: ButtonLinkSize; className?: string;
}) {
    return (
        <ButtonLink href="/register" variant={variant} size={size} className={className} event="Signup">
            {children}
        </ButtonLink>
    );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}

type Tone = 'bg' | 'surface' | 'soft' | 'green';

const TONES: Record<Tone, string> = {
    bg: 'bg-bg text-text',
    surface: 'bg-surface text-text',
    soft: 'bg-surface-2 text-text',
    green: 'bg-green text-cream',
};

export function Section({
    children, tone = 'bg', id, className, labelledBy,
}: {
    children: React.ReactNode; tone?: Tone; id?: string; className?: string; labelledBy?: string;
}) {
    return (
        <section id={id} aria-labelledby={labelledBy} className={cn('scroll-mt-20 py-12 sm:py-16 lg:py-24', TONES[tone], className)}>
            <Container>{children}</Container>
        </section>
    );
}

/** The scalloped awning between two sections. Decorative. */
export function Awning({ tone = 'gold', className }: { tone?: 'gold' | 'gold-green'; className?: string }) {
    return <AwningDivider tone={tone} size="md" className={className} />;
}

export function Eyebrow({ children, inverse }: { children: React.ReactNode; inverse?: boolean }) {
    return (
        <p className={cn('text-small font-semibold uppercase tracking-[0.08em]', inverse ? 'text-cream/90' : 'text-primary')}>
            {children}
        </p>
    );
}

/** Section heading: Bricolage 700 (Clash is reserved for page titles and the hero). */
export function SectionTitle({
    id, eyebrow, title, sub, inverse, className, align = 'left', as: Tag = 'h2',
}: {
    id?: string; eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; inverse?: boolean;
    className?: string; align?: 'left' | 'center'; as?: 'h2' | 'h3';
}) {
    return (
        <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
            {eyebrow && <Eyebrow inverse={inverse}>{eyebrow}</Eyebrow>}
            <Tag
                id={id}
                className={cn(
                    'mt-2 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] sm:text-[2.25rem] [text-wrap:balance]',
                    inverse ? 'text-cream' : 'text-text',
                )}
            >
                {title}
            </Tag>
            {sub && <p className={cn('mt-3 text-body sm:text-[1.0625rem]', inverse ? 'text-cream/90' : 'text-muted')}>{sub}</p>}
        </div>
    );
}

export function CheckList({ items, inverse, className }: { items: readonly string[]; inverse?: boolean; className?: string }) {
    return (
        <ul className={cn('space-y-3', className)}>
            {items.map((item) => (
                <li key={item} className={cn('flex gap-3 text-body', inverse ? 'text-cream' : 'text-text')}>
                    <span
                        aria-hidden
                        className={cn(
                            'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                            inverse ? 'bg-cream/15 text-cream' : 'bg-primary-soft text-primary',
                        )}
                    >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    );
}

/** A plain card on the brand surfaces. */
export function Panel({ children, className, lift }: { children: React.ReactNode; className?: string; lift?: boolean }) {
    return (
        <div className={cn('rounded-card border border-border bg-surface p-6 shadow-card', lift && cn(styles.lift, 'hover:shadow-card-hover'), className)}>
            {children}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Inner-page hero + breadcrumbs                                       */
/* ------------------------------------------------------------------ */

export interface Crumb { name: string; path: string }

export function Breadcrumbs({ crumbs, className }: { crumbs: readonly Crumb[]; className?: string }) {
    const all = [{ name: 'Home', path: '/' }, ...crumbs];
    return (
        <nav aria-label="Breadcrumb">
            <ol className={cn('flex flex-wrap items-center gap-1 text-small text-muted', className)}>
                {all.map((c, i) => {
                    const last = i === all.length - 1;
                    return (
                        <li key={c.path} className="flex items-center gap-1">
                            {last ? (
                                <span aria-current="page" className="text-text">{c.name}</span>
                            ) : (
                                <Link href={c.path} className="inline-flex min-h-[44px] items-center rounded-sm underline-offset-4 hover:text-text hover:underline">
                                    {c.name}
                                </Link>
                            )}
                            {!last && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/**
 * Top of every inner page: breadcrumbs, the page's one h1 (Clash), a line,
 * optional CTAs. Centred at every width so inner pages line up with each
 * other and with the stacked home hero.
 */
export function PageHero({
    eyebrow, title, sub, crumbs, children,
}: {
    eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; crumbs?: readonly Crumb[]; children?: React.ReactNode;
}) {
    return (
        <>
            <header className="bg-bg pb-12 pt-4 sm:pb-16 sm:pt-8">
                <Container>
                    {crumbs && <Breadcrumbs crumbs={crumbs} className="justify-center" />}
                    <div className={cn('mx-auto max-w-3xl text-center', crumbs ? 'mt-4 sm:mt-6' : 'mt-6')}>
                        {eyebrow && <div className={styles.enter}><Eyebrow>{eyebrow}</Eyebrow></div>}
                        <h1 className={cn('mt-3 font-display text-page-title text-text [text-wrap:balance] lg:text-[3rem] lg:leading-[1.05]', styles.enterTitle)}>
                            {title}
                        </h1>
                        {sub && <p className={cn('mx-auto mt-4 max-w-2xl text-[1.0625rem] text-muted sm:text-lg', styles.enter, styles.d1)}>{sub}</p>}
                        {children && <div className={cn('mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center', styles.enter, styles.d2)}>{children}</div>}
                    </div>
                </Container>
            </header>
            <Awning />
        </>
    );
}

/* ------------------------------------------------------------------ */
/* Closing call to action (green band)                                 */
/* ------------------------------------------------------------------ */

export function ClosingCTA({
    title, sub, secondary = { href: '/pricing', label: 'See pricing' },
}: {
    title: React.ReactNode; sub: string; secondary?: { href: string; label: string } | null;
}) {
    return (
        <section aria-labelledby="closing-cta" className="bg-green text-cream">
            <Awning />
            <Container className="py-14 sm:py-20">
                <div className="max-w-2xl">
                    <h2 id="closing-cta" className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] sm:text-[2.5rem] [text-wrap:balance]">
                        {title}
                    </h2>
                    <p className="mt-3 text-body text-cream/90 sm:text-lg">{sub}</p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        <SignupLink variant="accent">Start free</SignupLink>
                        {secondary && (
                            <ButtonLink href={secondary.href} variant="inverse-outline">
                                {secondary.label}
                            </ButtonLink>
                        )}
                    </div>
                    <p className="mt-4 text-small text-cream/90">No card needed. Nothing to set up first.</p>
                </div>
            </Container>
        </section>
    );
}

export { styles as motionStyles };
