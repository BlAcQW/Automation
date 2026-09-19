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

const nextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }];
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
