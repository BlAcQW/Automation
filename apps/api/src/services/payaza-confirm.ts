/**
 * "Confirm this Payaza reference": the one path from "Payaza may have been
 * paid for reference X" to an applied (or refused) fulfillment. Shared by
 *
 *   - the webhook (routes/payments/payaza.ts), after the signature check;
 *   - the reconciler (payaza-reconcile.ts), for webhooks Payaza never sent;
 *   - the ride sweeper's expiry guard, just before it would cancel a hold.
 *
 * TRUST. Nothing a caller passes is trusted for money: the kind and entity
 * come from OUR reference, the tenant must own that entity (owner resolver on
 * our row), and status / amount / currency come from Payaza's status query
 * keyed on the reference with that tenant's public key. The fulfiller checks
 * the amount against its own row (payment-fulfillers.ts contract).
 *
 * IDEMPOTENT. Fulfillers apply once per reference (advisory lock / guarded
 * claim), so the webhook, the reconciler and the sweeper may all confirm the
 * same reference, even concurrently: one applies, the others see
 * already_applied and send nothing.
 */
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import type { VerifyResult } from './paystack.js';
import { decrypt } from './crypto.js';
import { queryTransaction, type PayazaMode } from './payaza.js';
import {
    dispatchFulfillment, parseFulfillmentReference, resolveFulfillmentTenant,
    type DispatchResult, type FulfillerLogger,
} from './payment-fulfillers.js';
import { reportUnattributedCharge } from '../routes/payments/unattributed.js';

export type PayazaConfirmSource = 'webhook' | 'reconcile' | 'sweeper';

/** The tenant's Payaza fields as stored (public key still encrypted). A full Tenant row satisfies it. */
export interface PayazaTenantKeys {
    id: string;
    payazaPublicKey: string | null;
    payazaMode: string | null;
}

export interface ConfirmPayazaArgs {
    tenant: PayazaTenantKeys;
    reference: string;
    source: PayazaConfirmSource;
    /** Payaza's answer for this reference, when the caller already queried it (saves a second call). */
    prefetched?: VerifyResult;
    /** Kind + entity the caller already parsed AND matched to `tenant` via the owner resolver (the webhook does). */
    owned?: { kind: string; entityId: string };
}

export type ConfirmPayazaResult =
    | ({ outcome: 'dispatched' } & DispatchResult)
    | { outcome: 'not_ours' }
    | { outcome: 'no_keys' };

export interface ConfirmPayazaDeps {
    prisma: ExtendedPrismaClient;
    log: FulfillerLogger;
}

/** Payaza's status query failed (network, auth, 5xx). Transient: the webhook answers 502, the reconciler retries next tick. */
export class PayazaQueryFailed extends Error {
    constructor(public readonly cause: unknown) {
        super('payaza_query_failed');
        this.name = 'PayazaQueryFailed';
    }
}

export function payazaModeOf(raw: string | null | undefined): PayazaMode {
    return raw === 'LIVE' ? 'LIVE' : 'TEST';
}

/** Ask Payaza about one of OUR references with the tenant's key. Throws PayazaQueryFailed. */
export async function queryPayazaReference(tenant: PayazaTenantKeys, reference: string): Promise<VerifyResult> {
    if (!tenant.payazaPublicKey) throw new PayazaQueryFailed(new Error('no_public_key'));
    try {
        return await queryTransaction(decrypt(tenant.payazaPublicKey), payazaModeOf(tenant.payazaMode), reference);
    } catch (err) {
        throw new PayazaQueryFailed(err);
    }
}

/**
 * Apply whatever Payaza says about `reference` for `tenant`. Resolves for every
 * expected outcome (including "not paid yet": body.ignored = status_pending);
 * throws PayazaQueryFailed when Payaza could not be asked, and lets a
 * fulfiller's transient error through.
 */
export async function confirmPayazaReference(deps: ConfirmPayazaDeps, args: ConfirmPayazaArgs): Promise<ConfirmPayazaResult> {
    const { prisma, log } = deps;
    const { tenant, reference, source } = args;

    const parsed = args.owned ?? parseFulfillmentReference(reference);
    if (!parsed) return { outcome: 'not_ours' };
    if (!args.owned && (await resolveFulfillmentTenant(prisma, parsed.kind, parsed.entityId)) !== tenant.id) {
        return { outcome: 'not_ours' };
    }
    if (!tenant.payazaPublicKey) return { outcome: 'no_keys' };

    const metadata = { fulfillmentKind: parsed.kind, entityId: parsed.entityId };
    const result = await dispatchFulfillment({
        prisma,
        tenantId: tenant.id,
        reference,
        metadata,
        // Derived from our reference + our row (the status query is keyed on this very reference).
        trustedMetadata: { ...metadata, tenantId: tenant.id },
        provider: 'PAYAZA',
        log,
        verify: async () => {
            if (args.prefetched && args.prefetched.reference === reference) return args.prefetched;
            try {
                return await queryPayazaReference(tenant, reference);
            } catch (err) {
                log.error({ err: (err as PayazaQueryFailed).cause ?? err, tenantId: tenant.id, source }, 'Payaza status query failed');
                throw err;
            }
        },
    });

    if (result.unattributedReason) {
        await reportUnattributedCharge(prisma, log, 'Payaza', result.unattributedReason, {
            reference,
            tenantId: tenant.id,
            amount: result.amountMinor ?? null,
            currency: result.currency ?? null,
        });
    }
    if (source !== 'webhook' && result.body.ok === true && result.body.idempotent !== true) {
        // Money that would have been missed without the webhook: worth one line in the logs.
        log.info({ tenantId: tenant.id, reference, source, kind: parsed.kind }, 'Payaza payment confirmed without a webhook');
    }
    return { outcome: 'dispatched', ...result };
}
