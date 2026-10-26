import { cn } from '../cn';

/*
 * THE ONE PLACE TO SWAP THE REAL LOGO.
 * Today the mark is typographic (Clash Display "Bookly" / a "B" on green).
 * When the designer's storefront-B SVG lands, replace <Monogram/> (and the
 * wordmark if needed) below — every header, sidebar, loader and email
 * preview renders through <BrandLogo/>.
 */

type LogoSize = 'sm' | 'md' | 'lg' | 'xl';

interface BrandLogoProps {
    /** `wordmark` "Bookly" · `icon` the B monogram · `lockup` icon + wordmark. */
    variant?: 'wordmark' | 'icon' | 'lockup';
    size?: LogoSize;
    /** `default` green on light grounds · `inverse` cream for charcoal/green grounds. */
    tone?: 'default' | 'inverse';
    className?: string;
    /** Set false when a visible "Bookly" label sits right next to it. */
    labelled?: boolean;
}

const WORD: Record<LogoSize, string> = {
    sm: 'text-[20px]',
    md: 'text-[24px]',
    lg: 'text-[32px]',
    xl: 'text-[48px]',
};

const ICON: Record<LogoSize, string> = {
    sm: 'h-8 w-8 text-[18px] rounded-[9px]',
    md: 'h-10 w-10 text-[22px] rounded-[11px]',
    lg: 'h-12 w-12 text-[27px] rounded-[13px]',
    xl: 'h-16 w-16 text-[36px] rounded-[17px]',
};

function Monogram({ size }: { size: LogoSize }) {
    return (
        <span
            aria-hidden
            className={cn(
                'inline-flex shrink-0 items-center justify-center bg-primary font-display font-semibold leading-none text-cream shadow-soft',
                ICON[size],
            )}
        >
            <span className="translate-y-[0.04em]">B</span>
        </span>
    );
}

function Wordmark({ size, tone }: { size: LogoSize; tone: 'default' | 'inverse' }) {
    return (
        <span
            aria-hidden
            className={cn(
                'font-display font-semibold leading-none tracking-[-0.01em]',
                tone === 'inverse' ? 'text-cream' : 'text-primary',
                WORD[size],
            )}
        >
            Bookly
        </span>
    );
}

/** Bookly logo. Decorative children; the wrapper carries the accessible name. */
export function BrandLogo({ variant = 'wordmark', size = 'md', tone = 'default', className, labelled = true }: BrandLogoProps) {
    return (
        <span
            role={labelled ? 'img' : undefined}
            aria-label={labelled ? 'Bookly' : undefined}
            aria-hidden={labelled ? undefined : true}
            className={cn('inline-flex items-center gap-2.5', className)}
        >
            {variant !== 'wordmark' && <Monogram size={size} />}
            {variant !== 'icon' && <Wordmark size={size} tone={tone} />}
        </span>
    );
}
