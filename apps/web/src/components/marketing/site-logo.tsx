import Link from 'next/link';
import { BrandLogo } from '@bookingflow/ui';

/** The wordmark as a link home. Plain text wordmark only (logo work is on hold). */
export function SiteLogo({ tone = 'default', size = 'sm' }: { tone?: 'default' | 'inverse'; size?: 'sm' | 'md' | 'lg' }) {
    return (
        <Link
            href="/"
            aria-label="Bookly home"
            className="inline-flex min-h-[44px] items-center rounded-control"
        >
            <BrandLogo size={size} tone={tone} labelled={false} />
        </Link>
    );
}
