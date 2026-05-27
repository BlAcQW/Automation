/**
 * Build-time feature flags read from `NEXT_PUBLIC_*` env vars.
 *
 * PRODUCT mode (product/order/inventory dashboards, product bot flow, the
 * Product option on the signup picker) is parked while we launch the SERVICE
 * side. Set `NEXT_PUBLIC_ENABLE_PRODUCT_MODE=true` to re-enable everywhere.
 */
export const PRODUCT_MODE_ENABLED =
    process.env.NEXT_PUBLIC_ENABLE_PRODUCT_MODE === 'true';
