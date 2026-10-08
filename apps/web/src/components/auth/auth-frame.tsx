'use client';

import type { ReactNode } from 'react';
import { Logo } from '@/components/marketing/site/chrome';
import { Satin } from '@/components/marketing/site/satin';

/**
 * Auth frame — the "Forest ledger" split from the marketing reference.
 *
 * The whole viewport is the forest frame (`.theme-site`: 14px padding, 8px
 * on phones). Inside it, a paper panel holds the form; on lg+ a night satin
 * panel sits to the right with a short statement and one piece of product
 * proof. `.theme-site` / `.fs-paper` re-scope the ink tokens, so these pages
 * look the same whether or not `.dark` is on <html>.
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
        <main id="main" className="theme-site">
            <div className="mb-2 grid min-h-[calc(100dvh-16px)] gap-2 sm:mb-[14px] sm:min-h-[calc(100dvh-28px)] sm:gap-[14px] lg:grid-cols-2">
                <section className="fs-paper relative flex flex-col overflow-hidden rounded-[4px]">
                    <header className="p-3 sm:p-4">
                        <div className="fs-logo-pill w-fit" style={{ paddingRight: 12 }}>
                            <Logo />
                        </div>
                    </header>
                    <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-6 sm:px-10">
                        <div className="fs-in w-full max-w-[400px]">{children}</div>
                    </div>
                </section>

                <aside
                    aria-hidden
                    className="relative hidden overflow-hidden rounded-[4px] bg-forest-night text-forest-cream lg:block"
                >
                    <Satin variant={1} />
                    <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-12">
                        <p className="fs-key">/bookly/</p>
                        <div className="flex flex-col gap-8">
                            <p className="max-w-[16ch] text-[clamp(32px,3.2vw,48px)] font-normal leading-[1.02] tracking-[-0.05em] text-forest-cream">
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
        Your front desk,{' '}
        <span className="text-forest-cream/50">answering on WhatsApp while you work.</span>
    </>
);

/** Light panel on the satin: an illustration of a deposit landing, not a claim. */
function DepositProof() {
    return (
        <div className="fs-panel">
            <p className="fs-panel-k">Deposit received · Glow Hair Studio</p>
            <p className="fs-panel-v">GHS 50.00</p>
            <p className="fs-panel-g">Booked for Sat, 10:30 · held for you</p>
        </div>
    );
}

/* ---- shared form styling -------------------------------------------------
   Applied on top of the shared `Input` (packages/ui) without changing it:
   classes go through tailwind-merge, labels/error text are reached from the
   form with arbitrary variants. Colours are pinned forest values on purpose. */

export const AUTH_ERROR_RED = '#B03A2E';

export const authFormClass = [
    'space-y-4',
    '[&_label.block]:text-[12px] [&_label.block]:font-medium [&_label.block]:text-forest-ink',
].join(' ');

export const authInputClass = [
    'h-11 py-0 rounded-[5px] bg-[#FBFAF7] text-base text-forest-ink placeholder:text-forest-muted',
    'border-forest-ink/[.14] hover:border-forest-ink/25',
    'focus:border-forest-brand focus:ring-[3px] focus:ring-forest-brand/[.18]',
    'dark:focus:border-forest-brand dark:focus:ring-forest-brand/[.18]',
].join(' ');

export const authInputErrorClass =
    'border-[#B03A2E]/60 hover:border-[#B03A2E]/60 focus:border-[#B03A2E] focus:ring-[#B03A2E]/15 dark:focus:border-[#B03A2E] dark:focus:ring-[#B03A2E]/15';

const focusRing =
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-brand/30';

export const authPrimaryBtn = `fs-btn fs-btn--brand fs-btn--lg fs-btn--wide ${focusRing} disabled:pointer-events-none disabled:opacity-55`;
export const authPrimaryBtnInline = `fs-btn fs-btn--brand fs-btn--lg ${focusRing} disabled:pointer-events-none disabled:opacity-55`;
export const authGhostBtn = `fs-btn fs-btn--ghost fs-btn--lg ${focusRing}`;

export const authHeading =
    'text-[34px] sm:text-[40px] font-normal leading-[1] tracking-[-0.05em] text-forest-ink';
export const authSub = 'text-[15px] leading-relaxed text-[#5F675E]';
export const authLink =
    'font-medium text-forest-brand underline-offset-2 hover:underline transition-colors';
export const authMutedLink = 'text-[13px] text-[#5F675E] hover:text-forest-ink transition-colors';
export const authErrorBox =
    'rounded-[5px] border border-[#B03A2E]/25 bg-[#B03A2E]/[.06] px-3.5 py-2.5 text-[13px] leading-snug text-[#B03A2E]';
export const authNoticeBox =
    'rounded-[5px] border border-forest-ink/[.12] bg-[#ECEBE1] px-3.5 py-2.5 text-[13px] leading-snug text-forest-ink';
