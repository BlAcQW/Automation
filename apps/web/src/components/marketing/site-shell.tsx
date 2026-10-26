import { organizationJsonLd } from '@/lib/seo';
import { JsonLd } from './json-ld';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/**
 * Every public page: header, <main id="main"> (the skip-link target),
 * footer, and the Organization JSON-LD. Extra JSON-LD per page goes in `jsonLd`.
 */
export function SiteShell({
    children, current, jsonLd = [],
}: {
    children: React.ReactNode;
    /** The nav href to mark as the current page. */
    current?: string;
    jsonLd?: Record<string, unknown>[];
}) {
    return (
        <div className="min-h-screen overflow-x-clip bg-bg text-text">
            <SiteHeader current={current} />
            <main id="main" tabIndex={-1} className="outline-none">
                {children}
            </main>
            <SiteFooter />
            <JsonLd data={[organizationJsonLd(), ...jsonLd]} />
        </div>
    );
}
