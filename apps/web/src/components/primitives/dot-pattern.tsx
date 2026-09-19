import { useId } from 'react';
import { cn } from '@/lib/cn';

interface Props {
    /** Spacing between dots in px. */
    size?: number;
    radius?: number;
    className?: string;
}

/**
 * A dotted grid, the Magic UI pattern, drawn once as an SVG tile. Pair it
 * with a radial mask (`[mask-image:radial-gradient(...)]`) so it fades out
 * towards the edges instead of stamping the whole section.
 */
export function DotPattern({ size = 22, radius = 1, className }: Props) {
    const id = useId();
    return (
        <svg aria-hidden className={cn('pointer-events-none absolute inset-0 h-full w-full fill-ink-400/40', className)}>
            <defs>
                <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" x={0} y={0}>
                    <circle cx={size / 2} cy={size / 2} r={radius} />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id})`} />
        </svg>
    );
}
