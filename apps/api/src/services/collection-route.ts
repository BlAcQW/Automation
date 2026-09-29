/**
 * Deciding whose Paystack account a customer's payment lands in.
 *
 * The product goal is that a salon owner never creates a payment gateway
 * account or handles an API key — so by default money is collected into
 * BOOKLY's account and credited to their wallet.
 *
 * But tenants who already connected their own Paystack keep using it. Money
 * they are already collecting must never silently start landing somewhere
 * else; that is the kind of change that destroys trust permanently even when
 * the accounting is correct.
 *
 * The route also decides whether a wallet is credited at all. Money collected
 * into a tenant's own gateway never touches Bookly's balance, so crediting a
 * wallet for it would invent funds we do not hold and cannot pay out.
 */

import { decrypt } from './crypto.js';

export type CollectionRouteKind =
    /** Into Bookly's account. Credits the tenant's wallet. */
    | 'PLATFORM'
    /** Into the tenant's own Paystack. Never touches the ledger. */
    | 'OWN_GATEWAY';

export interface CollectionRoute {
    route: CollectionRouteKind;
    secretKey: string;
}

export interface CollectionRouteTenant {
    /** `Tenant.paystackSecretKey` as stored (encrypted), or null. */
    tenantSecretKeyEncrypted: string | null | undefined;
}

/**
 * Work out which account collects, or null when neither is usable.
 *
 * `decryptFn` is injected so the decision can be unit-tested without a real
 * encryption key, and so a corrupt stored key is a handled case rather than a
 * thrown exception in the middle of taking a payment.
 */
export function resolveCollectionRoute(
    tenant: CollectionRouteTenant,
    platformSecretKey: string | undefined | null,
    decryptFn: (value: string) => string = decrypt,
): CollectionRoute | null {
    if (tenant.tenantSecretKeyEncrypted) {
        try {
            const secretKey = decryptFn(tenant.tenantSecretKeyEncrypted);
            if (secretKey) return { route: 'OWN_GATEWAY', secretKey };
        } catch {
            // A rotated or corrupt key must not stop the business taking
            // money — fall through to the platform account below.
        }
    }

    if (platformSecretKey) return { route: 'PLATFORM', secretKey: platformSecretKey };
    return null;
}

/** Only platform-collected money exists in our balance, so only it is ledgered. */
export function shouldCreditLedger(route: CollectionRouteKind): boolean {
    return route === 'PLATFORM';
}
