'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Info } from 'lucide-react';
import { AwningDivider, BrandLogo, StatusPill, cn } from '@bookingflow/ui';
import { RotatingChannel } from '@/components/brand/rotating-channel';

/**
 * Auth frame: the cream page every sign-in / sign-up / reset screen sits on.
 *
 * Phones get one column: the wordmark, then the form. From `lg` a green panel
 * sits on the right with a short Clash statement and one small piece of
 * product proof, topped by the gold awning (the one gold moment on screen).
 * The panel is decoration only (aria-hidden); everything that matters lives
 * in the form column.
 */
export function AuthFrame({
    children,
    statement = DEFAULT_STATEMENT,
    proof = <DepositProof />,
}: {
    children: ReactNode;
    statement?: ReactNode;
    proof?: ReactNode;
}) {
    return (
        <main id="main" className="min-h-[100dvh] bg-bg text-text">
            <div className="mx-auto grid min-h-[100dvh] max-w-[1440px] lg:grid-cols-2 lg:gap-6 lg:p-6">
                <section className="flex flex-col">
                    <header className="px-4 pt-6 sm:px-8 lg:px-6 lg:pt-2">
                        <Link
                            href="/"
                            className="inline-flex min-h-[44px] items-center rounded-control"
                            aria-label="Bookly home"
                        >
                            <BrandLogo size="md" labelled={false} />
                        </Link>
                    </header>
                    <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-8 sm:items-center sm:px-8 sm:pt-6">
                        <div className="w-full max-w-[440px]">{children}</div>
                    </div>
                </section>

                <aside
                    aria-hidden
                    className="relative hidden overflow-hidden rounded-card-lg bg-green text-cream shadow-card-lg lg:flex lg:flex-col"
                >
                    <AwningDivider size="lg" />
                    <div className="flex flex-1 flex-col justify-between p-10 xl:p-12">
                        <p className="text-small font-semibold uppercase tracking-[0.12em] text-cream/80">
                            Your shop, always open.
                        </p>
                        <div className="flex flex-col gap-8">
                            <p className="max-w-[18ch] font-display text-[clamp(2rem,1.2rem+1.8vw,3rem)] font-semibold leading-[1.08] tracking-[-0.015em]">
                                {statement}
                            </p>
                            {proof}
                        </div>
                    </div>
                </aside>
            </div>
        </main>
    );
}

const DEFAULT_STATEMENT = (
    <>
        Your customers book on <RotatingChannel />.{' '}
        <span className="text-cream/70">You get on with your day.</span>
    </>
);

/** A small card on the green panel: an illustration of a deposit landing, not a claim. */
function DepositProof() {
    return (
        <div className="max-w-sm rounded-card bg-surface p-5 text-text shadow-card">
            <div className="flex items-center justify-between gap-3">
                <p className="text-small font-medium text-muted">Maison Skin Clinic</p>
                <StatusPill status="paid" label="Deposit paid" size="sm" />
            </div>
            <p className="mt-3 text-[28px] font-bold leading-none tabular-nums">GH₵ 200.00</p>
            <p className="mt-2 text-small text-muted">Thursday, 4:30 pm · HydraFacial for Efua</p>
        </div>
    );
}

/* ---- shared pieces for the auth pages ------------------------------------ */

/** The page's one h1, in Clash, plus an optional friendly line under it. */
export function AuthTitle({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
    return (
        <div className={cn('mb-8', className)}>
            <h1 className="font-display text-page-title text-text">{children}</h1>
            {sub && <p className="mt-3 max-w-[42ch] text-body leading-relaxed text-muted">{sub}</p>}
        </div>
    );
}

export const FRIENDLY_ERROR_TITLE = "Oops, that didn't work. Let's try again.";

/**
 * Form-level message. `error` uses the friendly Bookly headline, then says
 * what happened and what to do next; `notice` is a calm heads-up.
 */
export function AuthAlert({
    tone = 'error',
    title,
    children,
    className,
}: {
    tone?: 'error' | 'notice';
    title?: ReactNode;
    children?: ReactNode;
    className?: string;
}) {
    const isError = tone === 'error';
    const Icon = isError ? AlertCircle : Info;
    return (
        <div
            role={isError ? 'alert' : 'status'}
            className={cn(
                'mb-6 flex items-start gap-3 rounded-control border px-4 py-3 text-[15px] leading-snug',
                isError ? 'border-error/30 bg-error-soft text-text' : 'border-border bg-surface-2 text-text',
                className,
            )}
        >
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', isError ? 'text-error-fg' : 'text-primary')} aria-hidden />
            <div className="min-w-0">
                {(title ?? (isError ? FRIENDLY_ERROR_TITLE : null)) && (
                    <p className="font-semibold">{title ?? FRIENDLY_ERROR_TITLE}</p>
                )}
                {children && <div className={cn(isError || title ? 'mt-1 text-muted' : '')}>{children}</div>}
            </div>
        </div>
    );
}

/** Inline text link in the brand green (AA on cream and white). */
export const authLink =
    'font-semibold text-primary underline-offset-4 hover:underline rounded-sm transition-colors duration-ui';

/** Quiet secondary link (back links, "forgot password"). At least 44px tall. */
export const authMutedLink =
    'inline-flex min-h-[44px] items-center gap-1.5 rounded-control text-[15px] font-medium text-muted hover:text-text transition-colors duration-ui';

/** Footer line under a form ("New to Bookly? Join the waitlist"). */
export function AuthFootnote({ children }: { children: ReactNode }) {
    return <p className="mt-8 text-center text-[15px] text-muted">{children}</p>;
}
