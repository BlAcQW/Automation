/**
 * Which Paystack key signs an inbound webhook.
 *
 * Paystack signs with the secret of the account the event belongs to. Bookly
 * now has two: the platform account (which collects for tenants who never set
 * up a gateway, and which sends every payout) and each tenant's own account
 * for those who connected one before.
 *
 * Verifying against the wrong one rejects a genuine event, and a rejected
 * charge means a customer paid and nobody was told.
 */

export type WebhookSecretSource = 'PLATFORM' | 'TENANT';

const PLATFORM_PREFIX = 'bf_p_';

/**
 * Decide which key to verify with.
 *
 * Transfers are always ours. Charges depend on where the money was collected,
 * which is stamped on the metadata at initialize time with the reference
 * prefix as a fallback for replays that arrive without it. Anything
 * unrecognised is treated as the tenant's, because every payment taken before
 * platform collection existed went through their own account.
 */
export function selectWebhookSecretSource(
    event: string | undefined,
    reference: string | undefined,
    metadata: { collectionRoute?: unknown } | null | undefined,
): WebhookSecretSource {
    if (event?.startsWith('transfer.')) return 'PLATFORM';

    const declared = metadata?.collectionRoute;
    if (declared === 'PLATFORM') return 'PLATFORM';
    if (declared === 'OWN_GATEWAY') return 'TENANT';

    if (reference?.startsWith(PLATFORM_PREFIX)) return 'PLATFORM';
    return 'TENANT';
}
