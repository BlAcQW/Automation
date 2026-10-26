/** @type {import('next').NextConfig} */

// Security headers. No Content-Security-Policy yet: the WhatsApp Embedded
// Signup loads Meta's SDK and opens their dialog, Paystack opens its checkout,
// and Next injects inline scripts, so a strict CSP needs a nonce pipeline and a
// test pass against both flows. The headers below are the ones every scanner
// checks and none of them can break a feature.
const securityHeaders = [
    // Browsers remember to use https for a year. Preload-ready.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
    // Nobody may frame the app (clickjacking). Paystack/Meta open in their own windows.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // The app never needs these device APIs; the WebView signup runs in the mobile app, not here.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=()' },
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

// Signed-in and transactional routes: never in search results. Mirrors
// PRIVATE_ROUTES in src/lib/site.ts (which feeds robots.txt). robots.txt only
// stops crawling; this header stops indexing of anything already linked.
const NOINDEX_ROUTES = [
    'dashboard', 'bookings', 'services', 'availability', 'conversations', 'customers',
    'channels', 'whatsapp', 'templates', 'settings', 'orders', 'products', 'inventory',
    'money', 'admin', 'design-system', 'pay', 'track', 'c', 'forgot-password',
    'reset-password', 'verify-email', 'offline', 'api',
];
const noindexHeaders = NOINDEX_ROUTES.flatMap((r) => [
    { source: `/${r}`, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    { source: `/${r}/:path*`, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
]);

const nextConfig = {
    reactStrictMode: true,
    // The shared packages (packages/*) are source-only TypeScript, resolved
    // through the tsconfig path aliases. externalDir lets Next compile files
    // that live outside apps/web; transpilePackages names them explicitly.
    transpilePackages: ['@bookingflow/ui', '@bookingflow/api-client', '@bookingflow/auth-client'],
    experimental: { externalDir: true },
    poweredByHeader: false,
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }, ...noindexHeaders];
    },
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/:path*`,
            },
        ];
    },
};

module.exports = nextConfig;
