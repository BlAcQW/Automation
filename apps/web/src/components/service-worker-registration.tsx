'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
    useEffect(() => {
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
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
