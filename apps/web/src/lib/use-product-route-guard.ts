'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PRODUCT_MODE_ENABLED } from './feature-flags';

/**
 * Client-side guard for the PRODUCT-only dashboard routes (/products,
 * /orders, /inventory, /customers). When PRODUCT mode is parked, redirect
 * back to /dashboard and signal the caller to render nothing.
 *
 *   const enabled = useProductRouteGuard();
 *   if (!enabled) return null;
 */
export function useProductRouteGuard(): boolean {
    const router = useRouter();
    useEffect(() => {
        if (!PRODUCT_MODE_ENABLED) router.replace('/dashboard');
    }, [router]);
    return PRODUCT_MODE_ENABLED;
}
