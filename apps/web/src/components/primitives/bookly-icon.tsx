import { useId } from 'react';
import { cn } from '@/lib/cn';

interface BooklyIconProps extends React.SVGAttributes<SVGElement> {
    className?: string;
}

/**
 * Bookly brand glyph — rounded chat bubble silhouette with three booking-slot
 * bars knocked out inside it. WhatsApp + scheduling in one mark. Pairs with
 * the BooklyWordmark (text + dot); use this where a square-aspect glyph
 * fits better (PWA icon companion, install prompt, offline page).
 */
export function BooklyIcon({ className, ...rest }: BooklyIconProps) {
    const gid = useId();
    const gradId = `bookly-grad-${gid.replace(/:/g, '')}`;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={cn('inline-block', className)}
            {...rest}
        >
            <defs>
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
            </defs>

            {/* Chat bubble silhouette with bottom-left tail. */}
            <path
                d="M5 2.5h14a3.5 3.5 0 0 1 3.5 3.5v9a3.5 3.5 0 0 1-3.5 3.5H8.4l-3.55 3.18a.75.75 0 0 1-1.25-.56V18.5A3.5 3.5 0 0 1 1.5 15V6A3.5 3.5 0 0 1 5 2.5Z"
                fill={`url(#${gradId})`}
            />

            {/* Three booking-slot bars knocked out inside the bubble. */}
            <rect x="6.5" y="6.5" width="11" height="1.6" rx="0.8" fill="#050807" />
            <rect x="6.5" y="9.7" width="9" height="1.6" rx="0.8" fill="#050807" />
            <rect x="6.5" y="12.9" width="10" height="1.6" rx="0.8" fill="#050807" />
        </svg>
    );
}
