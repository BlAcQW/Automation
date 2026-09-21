import { NextResponse, type NextRequest } from 'next/server';

// Edge middleware that prevents flash-of-protected-content. It checks for
// the presence of the auth cookie before any protected page renders; the
// cookie is set in tandem with localStorage at login (see lib/auth.tsx and
// app/admin/login/page.tsx). The cookie carries the same JWT the API
// validates on every request, so this is a presence-check, not a validity
// check.
// Build an absolute URL on the PUBLIC origin. Behind nginx, `request.nextUrl`
// carries the server's own bind address (e.g. localhost:3006), so redirecting
// with `nextUrl.clone()` sent users to https://localhost:3006/login. The proxy
// forwards the real host/scheme in standard headers; prefer those, falling back
// to nextUrl only when they're absent (local dev).
function publicUrl(request: NextRequest, pathname: string, search = ''): URL {
    const proto =
        request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
    const host =
        request.headers.get('x-forwarded-host') ??
        request.headers.get('host') ??
        request.nextUrl.host;
    return new URL(`${pathname}${search}`, `${proto}://${host}`);
}

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // ----------------- Admin routes -----------------
    // The admin console has its own session. Its login page must be reachable
    // with no cookie at all; before this, it fell through to the tenant check
    // below and bounced to /login, so nobody could ever sign in as an admin.
    if (pathname.startsWith('/admin')) {
        if (pathname === '/admin/login') return NextResponse.next();
        const adminToken = request.cookies.get('adminAccessToken');
        if (!adminToken) {
            return NextResponse.redirect(publicUrl(request, '/admin/login'));
        }
        return NextResponse.next();
    }

    // ----------------- Tenant dashboard routes -----------------
    const token = request.cookies.get('accessToken');
    if (!token) {
        const next = `?next=${encodeURIComponent(pathname)}`;
        return NextResponse.redirect(publicUrl(request, '/login', next));
    }

    return NextResponse.next();
}

// Match only the routes that actually require auth. Public routes (/, /login,
// /register) are deliberately omitted; static assets and Next.js internals
// are excluded by the negative lookahead inside each matcher.
export const config = {
    matcher: [
        '/dashboard/:path*',
        '/services/:path*',
        '/products/:path*',
        '/inventory/:path*',
        '/orders/:path*',
        '/bookings/:path*',
        '/availability/:path*',
        '/customers/:path*',
        '/conversations/:path*',
        '/whatsapp/:path*',
        '/settings/:path*',
        '/templates/:path*',
        '/admin/:path*',
    ],
};
