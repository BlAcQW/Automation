import { BrandLogo } from '@bookingflow/ui';

interface BooklyIconProps {
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * Brand mark slot (install prompt, offline page). The logo art is on hold,
 * so this renders the plain "Bookly" wordmark. Prefer `<BrandLogo />` in
 * new code.
 */
export function BooklyIcon({ className, size = 'md' }: BooklyIconProps) {
    return <BrandLogo size={size} className={className} />;
}
