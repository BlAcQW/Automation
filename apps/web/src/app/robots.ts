import type { MetadataRoute } from 'next';
import { PRIVATE_ROUTES, SITE_URL, absoluteUrl } from '@/lib/site';

/**
 * Marketing, landing and legal pages are for search engines; the signed-in
 * app and transactional links (pay, track, c/…) are not. The same list
 * drives the `X-Robots-Tag: noindex` header in next.config.js.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                // `/dashboard` (no trailing slash) also covers /dashboard/… and /dashboard?x.
                disallow: [...PRIVATE_ROUTES],
            },
        ],
        sitemap: absoluteUrl('/sitemap.xml'),
        host: SITE_URL,
    };
}
