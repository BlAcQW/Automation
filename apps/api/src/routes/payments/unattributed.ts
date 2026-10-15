/**
 * A signature-verified charge that matches nothing of ours: money arrived and
 * nothing is attributed. Shared by the Paystack and Payaza webhooks. Still 200
 * to the provider (it must not retry forever), but loud: error log, an audit
 * row a human can find, and a critical alert deduped per tenant + reference.
 */
import type { ExtendedPrismaClient } from '../../plugins/prisma.js';
import { audit } from '../../services/audit.js';
import { raiseAlert } from '../../services/alerts.js';

export interface UnattributedChargeInput {
    reference: string;
    tenantId: string;
    amount?: number | null;
    currency?: string | null;
}

/**
 * Real provider references are short; a tenant holding its own key can sign a
 * webhook with any reference it likes, so bound what reaches logs and audit.
 */
export const MAX_LOGGED_REFERENCE_LENGTH = 100;
const MAX_LOGGED_CURRENCY_LENGTH = 8;

/** Shape the log line and audit entry for a verified charge we could not attribute. */
export function buildUnattributedChargeReport(reason: string, input: UnattributedChargeInput) {
    const amountMinor =
        typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null;
    const currency =
        typeof input.currency === 'string' ? input.currency.slice(0, MAX_LOGGED_CURRENCY_LENGTH) : null;
    const reference = String(input.reference).slice(0, MAX_LOGGED_REFERENCE_LENGTH);
    const base = { reference, tenantId: input.tenantId, amountMinor, currency, reason };
    return { auditAction: 'payment.unattributed', targetId: reference, log: base, metadata: base };
}

export type ChargeProviderLabel = 'Paystack' | 'Payaza';

export async function reportUnattributedCharge(
    prisma: ExtendedPrismaClient,
    log: { error: (obj: object, msg: string) => void },
    provider: ChargeProviderLabel,
    reason: string,
    input: UnattributedChargeInput,
): Promise<void> {
    const report = buildUnattributedChargeReport(reason, input);
    log.error(report.log, `Verified ${provider} charge could not be attributed`);
    await audit({
        prisma,
        action: report.auditAction,
        actorType: 'SYSTEM',
        tenantId: input.tenantId,
        targetType: `${provider}Charge`,
        targetId: report.targetId,
        metadata: report.metadata,
    });
    await raiseAlert(prisma, {
        kind: 'payment.unattributed',
        severity: 'critical',
        tenantId: input.tenantId,
        message: `Verified ${provider} charge could not be attributed (${reason}).`,
        context: { reference: input.reference, reason, amount: input.amount, currency: input.currency },
        // Tenant in the key: two tenants' charges sharing a reference stay separate.
        dedupeKey: `payment.unattributed:${input.tenantId}:${String(input.reference)}`,
    });
}
