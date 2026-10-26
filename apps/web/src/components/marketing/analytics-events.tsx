'use client';

import { useEffect } from 'react';
import { isAnalyticsEvent, isWhatsAppHref, track } from '@/lib/analytics';

/**
 * One delegated click listener for the whole site, mounted once in the root
 * layout. Server components mark links with `data-analytics="Signup"` and
 * stay server components; any wa.me link anywhere (support links, footers,
 * settings) is reported as `WhatsApp Click` without touching its component.
 */
export function AnalyticsEvents() {
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            const target = e.target instanceof Element ? e.target : null;
            const el = target?.closest<HTMLElement>('[data-analytics], a[href]');
            if (!el) return;
            const named = el.getAttribute('data-analytics');
            const page = window.location.pathname;
            if (isAnalyticsEvent(named)) track(named, { page });
            const href = el.getAttribute('href');
            if (named !== 'WhatsApp Click' && isWhatsAppHref(href)) track('WhatsApp Click', { page });
        };
        document.addEventListener('click', onClick, { capture: true });
        return () => document.removeEventListener('click', onClick, { capture: true });
    }, []);
    return null;
}
