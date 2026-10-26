import { BrandLogo } from '@bookingflow/ui';

interface BooklyIconProps {
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * Square brand glyph (install prompt, offline page). The old chat-bubble
 * mark is retired; this renders the BrandLogo "B" monogram. Prefer
 * `<BrandLogo variant="icon" />` in new code.
 */
export function BooklyIcon({ className, size = 'md' }: BooklyIconProps) {
    return <BrandLogo variant="icon" size={size} className={className} />;
}
