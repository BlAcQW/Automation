import { cn } from '../cn';

interface LogoRevealProps {
    /** Cap height scale. */
    size?: 'md' | 'lg' | 'xl';
    tone?: 'default' | 'inverse';
    className?: string;
}

const SIZE = {
    md: { box: 'h-12 w-12 rounded-[13px] text-[28px]', word: 'text-[36px]' },
    lg: { box: 'h-16 w-16 rounded-[17px] text-[38px]', word: 'text-[48px]' },
    xl: { box: 'h-20 w-20 rounded-[21px] text-[48px]', word: 'text-[64px]' },
} as const;

/**
 * Homepage "shop opening": the shop (green square) rises, its gold
 * scalloped awning drops, the B appears, then "ookly" slides in beside it.
 *
 * Pure CSS keyframes (`.lr-*` in globals.css), server-rendered: no
 * hydration needed, and the RESTING STATE IS FULLY VISIBLE — with reduced
 * motion the animation is off and the logo simply sits there.
 * Total ≈ 700ms. Uses the placeholder typographic mark (see BrandLogo).
 */
export function LogoReveal({ size = 'lg', tone = 'default', className }: LogoRevealProps) {
    const s = SIZE[size];
    return (
        <span role="img" aria-label="Bookly" className={cn('logo-reveal inline-flex items-end gap-0.5', className)}>
            <span aria-hidden className={cn('lr-shop relative inline-flex items-center justify-center bg-primary font-display font-semibold leading-none text-cream shadow-card', s.box)}>
                <span className="lr-awning absolute inset-x-0 top-0 h-[22%] overflow-hidden rounded-t-[inherit]">
                    <span className="lr-awning-stripes block h-full w-full" />
                </span>
                <span className="lr-b translate-y-[0.08em]">B</span>
            </span>
            <span aria-hidden className="lr-word-clip inline-block overflow-hidden pb-[0.08em]">
                <span
                    className={cn(
                        'lr-word inline-block font-display font-semibold leading-none tracking-[-0.01em]',
                        tone === 'inverse' ? 'text-cream' : 'text-primary',
                        s.word,
                    )}
                >
                    ookly
                </span>
            </span>
        </span>
    );
}
