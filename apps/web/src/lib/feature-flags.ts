/**
 * Build-time feature flags read from `NEXT_PUBLIC_*` env vars.
 *
 * PRODUCT mode (product/order/inventory dashboards, product bot flow, the
 * Product option on the signup picker) is parked while we launch the SERVICE
 * side. Set `NEXT_PUBLIC_ENABLE_PRODUCT_MODE=true` to re-enable everywhere.
 */
export const PRODUCT_MODE_ENABLED =
    process.env.NEXT_PUBLIC_ENABLE_PRODUCT_MODE === 'true';

/**
 * Self sign-up. CLOSED unless `NEXT_PUBLIC_REGISTRATION_OPEN=true` at build
 * time: every "Start free" becomes "Join waitlist" (→ /waitlist) and /register
 * only works with a waitlist invite. The API enforces the same rule on its own
 * (REGISTRATION_OPEN); this flag only changes what the site shows.
 * Flip both, rebuild the web, restart the API, and sign-up is open again.
 */
export const REGISTRATION_OPEN =
    process.env.NEXT_PUBLIC_REGISTRATION_OPEN === 'true';
