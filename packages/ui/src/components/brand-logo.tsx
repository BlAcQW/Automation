import { cn } from '../cn';

/*
 * THE ONE PLACE TO SWAP THE REAL LOGO.
 * Logo work is on hold (owner, 2026-10-26): the mark is the plain text
 * "Bookly", and where a square mark is needed we show the EXISTING app icon
 * file (/icons/icon-96.png) unchanged — no new logo art. When the designer's
 * files arrive, replace <AppIcon/> and <Wordmark/> below; every header,
 * sidebar and loader renders through <BrandLogo/>.
 */

type LogoSize = 'sm' | 'md' | 'lg' | 'xl';

interface BrandLogoProps {
    /** `wordmark` text "Bookly" · `icon` the existing app icon file · `lockup` same as wordmark while logo work is on hold. */
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
    sm: 'h-8 w-8 rounded-[9px]',
    md: 'h-10 w-10 rounded-[11px]',
    lg: 'h-12 w-12 rounded-[13px]',
    xl: 'h-16 w-16 rounded-[17px]',
};

function AppIcon({ size }: { size: LogoSize }) {
    // The existing app icon, as-is. Not new logo art.
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/icons/icon-96.png" alt="" aria-hidden width={48} height={48} className={cn('shrink-0 object-contain', ICON[size])} />
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
            {variant === 'icon' ? <AppIcon size={size} /> : <Wordmark size={size} tone={tone} />}
        </span>
    );
}
