import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Only the marketing and legal pages are for search engines; the app is not. */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: ['/', '/privacy', '/terms', '/support', '/login', '/register'],
                disallow: [
                    '/dashboard', '/bookings', '/services', '/availability', '/conversations',
                    '/customers', '/whatsapp', '/templates', '/settings', '/orders', '/products',
                    '/inventory', '/admin', '/pay', '/track', '/c/', '/api/', '/reset-password',
                    '/verify-email', '/offline',
                ],
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    };
}
