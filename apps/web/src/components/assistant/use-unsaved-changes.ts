'use client';

/**
 * Warn before leaving with unsaved changes.
 *
 * - Closing the tab or reloading: the browser's own beforeunload prompt.
 * - Following an in-app link (sidebar, tab bar, back to Settings): the click is
 *   held and `pendingHref` is set, so the page can show a ConfirmDialog; call
 *   `leave()` to go anyway or `stay()` to cancel. Links that open a new tab,
 *   download, or jump within this page are left alone.
 *
 * The App Router has no route-change event to veto, so links are caught in the
 * capture phase before Next's own handler sees them.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function useUnsavedChanges(dirty: boolean) {
    const router = useRouter();
    const [pendingHref, setPendingHref] = useState<string | null>(null);

    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
            const url = new URL(a.href, window.location.href);
            if (url.origin !== window.location.origin) return;
            if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page / #anchor
            e.preventDefault();
            e.stopPropagation();
            setPendingHref(`${url.pathname}${url.search}${url.hash}`);
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        document.addEventListener('click', onClick, true);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            document.removeEventListener('click', onClick, true);
        };
    }, [dirty]);

    const leave = useCallback(() => {
        const href = pendingHref;
        setPendingHref(null);
        if (href) router.push(href);
    }, [pendingHref, router]);

    const stay = useCallback(() => setPendingHref(null), []);

    return { pendingHref, leave, stay };
}
