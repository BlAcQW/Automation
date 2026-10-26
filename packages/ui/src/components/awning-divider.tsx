import { type CSSProperties } from 'react';
import { cn } from '../cn';

interface AwningDividerProps {
    /** `gold`: two-tone gold stripes (default) · `gold-green`: gold + green · `solid`: plain gold. */
    tone?: 'gold' | 'gold-green' | 'solid';
    /** Stripe width / scallop diameter. */
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const SIZES = { sm: { w: 16, band: 4 }, md: { w: 24, band: 6 }, lg: { w: 32, band: 10 } } as const;

const STRIPES: Record<NonNullable<AwningDividerProps['tone']>, [string, string]> = {
    gold: ['#E8A317', '#F2C35B'],
    'gold-green': ['#E8A317', '#0F6B4F'],
    solid: ['#E8A317', '#E8A317'],
};

/**
 * The Bookly signature: a scalloped shop-awning stripe. Decorative only
 * (aria-hidden). Pure CSS — a striped band masked into a straight top edge
 * and a row of half-circle scallops — so it scales to any width with no JS.
 * Use under the dashboard header and between marketing sections; once per view.
 */
export function AwningDivider({ tone = 'gold', size = 'md', className }: AwningDividerProps) {
    const { w, band } = SIZES[size];
    const r = w / 2;
    const [a, b] = STRIPES[tone];
    const mask = [
        `linear-gradient(#000 0 0) top / 100% ${band}px no-repeat`,
        `radial-gradient(circle at ${r}px ${band}px, #000 ${r}px, transparent ${r + 0.5}px) 0 0 / ${w}px ${band + r}px repeat-x`,
    ].join(', ');
    const style: CSSProperties = {
        height: band + r,
        backgroundImage: `repeating-linear-gradient(90deg, ${a} 0 ${w}px, ${b} ${w}px ${w * 2}px)`,
        WebkitMask: mask,
        mask,
    };
    return <div aria-hidden className={cn('w-full shrink-0', className)} style={style} />;
}
