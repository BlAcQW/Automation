import type { ReactNode } from 'react';

/**
 * Shell for the public, customer-facing pages (pay result, order tracking,
 * cancel link): a paper page with one centred 440px column. Colours are
 * pinned forest values, not theme tokens — these pages are opened from a
 * WhatsApp message and must look the same whatever theme the browser
 * last stored for the dashboard.
 */
export function PublicPage({ children }: { children: ReactNode }) {
    return (
        <main
            id="main"
            className="min-h-screen bg-forest-paper text-forest-ink [color-scheme:light] flex items-start justify-center px-4 py-10 sm:py-16"
        >
            <div className="w-full max-w-[440px]">{children}</div>
        </main>
    );
}

/** Paper panel — the page's main card. */
export function PaperCard({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={`rounded-[6px] bg-[#FBFAF7] p-6 sm:p-7 shadow-[0_14px_30px_-22px_rgba(20,26,22,0.45)] ring-1 ring-forest-ink/[.07] ${className}`}
        >
            {children}
        </div>
    );
}

/** Dark forest summary card — the facts the customer came to check. */
export function SummaryCard({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={`rounded-[6px] bg-forest-card p-4 text-forest-cream shadow-[0_30px_50px_-28px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}
        >
            {children}
        </div>
    );
}

export const publicTitle = 'text-[28px] sm:text-[32px] font-normal leading-[1.05] tracking-[-0.045em] text-forest-ink';
export const publicBody = 'text-[14px] leading-relaxed text-[#5F675E]';
export const publicEyebrow = 'text-[12px] font-medium text-[#5F675E]';
export const publicFine = 'text-[12px] text-[#7F857B]';

const focusRing = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-brand/30';
export const publicBrandBtn = `fs-btn fs-btn--brand fs-btn--lg ${focusRing} disabled:pointer-events-none disabled:opacity-60`;
export const publicDangerBtn = `fs-btn fs-btn--lg fs-btn--wide bg-[#B03A2E] text-[#FBFAF7] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-[#962F25] ${focusRing} disabled:pointer-events-none disabled:opacity-60`;
