import { BrandLogo } from '@bookingflow/ui';

interface BooklyWordmarkProps {
    className?: string;
    size?: 'nav' | 'lg' | 'xl';
    /** Cream wordmark for charcoal / green grounds. */
    tone?: 'default' | 'inverse';
}

/**
 * Kept for existing imports — renders the canonical <BrandLogo/> wordmark
 * (Clash Display). New code: import BrandLogo from @bookingflow/ui.
 */
export function BooklyWordmark({ className, size = 'nav', tone = 'default' }: BooklyWordmarkProps) {
    const map = { nav: 'md', lg: 'lg', xl: 'xl' } as const;
    return <BrandLogo variant="wordmark" size={map[size]} tone={tone} className={className} />;
}
