'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
    useEffect(() => {
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            // When a new service worker takes control, reload once so the page
            // runs fresh code instead of whatever the old worker served. The
            // guard prevents a reload loop; the `controller` check skips the
            // very first install (null → controller) where there is no stale
            // page to escape.
            let reloading = false;
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (reloading) return;
                    reloading = true;
                    window.location.reload();
                });
            }

            window.addEventListener('load', () => {
                navigator.serviceWorker
                    .register('/sw.js')
                    .then((registration) => {
                        // Check for SW updates periodically.
                        setInterval(() => {
                            registration.update();
                        }, 60 * 60 * 1000);
                    })
                    .catch(() => {
                        // Service worker registration is a progressive enhancement —
                        // failure here must not break the page. Sentry is configured
                        // separately if installation telemetry is needed.
                    });
            });
        }
    }, []);

    return null;
}
