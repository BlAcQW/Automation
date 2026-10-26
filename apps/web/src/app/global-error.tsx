'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Last resort: the root layout itself crashed, so none of its CSS, fonts or
 * providers can be trusted. Everything here is inline and dependency-free,
 * in the brand colours (cream, charcoal, green, gold awning).
 */
const C = { cream: '#FAF6EE', charcoal: '#1F2328', green: '#0F6B4F', gold: '#E8A317', muted: '#5F6672', border: '#E7E1D6' };

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html lang="en-GH">
            <head>
                <title>Something went wrong · Bookly</title>
                <meta name="robots" content="noindex" />
            </head>
            <body style={{ margin: 0, background: C.cream, color: C.charcoal, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
                <main
                    id="main"
                    style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}
                >
                    <div style={{ width: '100%', maxWidth: 520, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 24, overflow: 'hidden' }}>
                        <div aria-hidden style={{ height: 12, background: `repeating-linear-gradient(90deg, ${C.gold} 0 24px, ${C.green} 24px 48px)` }} />
                        <div style={{ padding: 28 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 22, color: C.green }}>Bookly</p>
                            <h1 style={{ margin: '20px 0 0', fontSize: 30, lineHeight: 1.15 }}>Oops, that didn&apos;t work.</h1>
                            <p style={{ margin: '12px 0 0', fontSize: 16, lineHeight: 1.55, color: C.muted }}>
                                Bookly hit a problem loading this page. Your bookings and chats are safe. Let&apos;s try again.
                            </p>
                            {error.digest && (
                                <p style={{ margin: '16px 0 0', fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>Reference: {error.digest}</p>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
                                <button
                                    type="button"
                                    onClick={() => reset()}
                                    style={{ minHeight: 48, padding: '0 22px', borderRadius: 12, border: 0, background: C.green, color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Try again
                                </button>
                                <a
                                    href="/"
                                    style={{ minHeight: 48, padding: '0 22px', borderRadius: 12, border: `1px solid ${C.border}`, color: C.charcoal, fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                                >
                                    Go to the home page
                                </a>
                            </div>
                        </div>
                    </div>
                </main>
            </body>
        </html>
    );
}
