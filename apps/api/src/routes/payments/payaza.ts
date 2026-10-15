/**
 * Payaza: per-organisation settings and the webhook. Registered under
 * /payments/payaza by routes/payments/index.ts.
 *
 *   POST /payments/payaza/connect     owner-only: validate, probe, encrypt, store
 *   POST /payments/payaza/disconnect  owner-only: clear keys (back to Paystack)
 *   POST /payments/payaza/webhook     Payaza collection notifications
 *
 * WEBHOOK TRUST MODEL. Payaza's payload names no tenant we can trust and echoes
 * no metadata. So:
 *  1. The reference must be one of OUR fulfillment references
 *     (bf_f_{kind}_{entityId}_{ts}); anything else is someone else's sale on
 *     the same Payaza account and is acknowledged quietly.
 *  2. The tenant comes from OUR stored row for that entity (owner resolver per
 *     kind), and only that tenant's Payaza secret can verify the signature.
 *  3. Only a signed `Completed` notification proceeds, and even then nothing
 *     in it is used: Payaza's status query (keyed on our reference, with that
 *     tenant's public key) is the source of truth for status, amount and
 *     currency. The fulfiller checks the amount against its own row.
 *  4. Retries are not documented by Payaza, so everything is idempotent per
 *     reference (fulfiller contract) and a transient failure answers 5xx.
 *  5. Payaza does not always call (TURBO, 2026-10: a paid Founding Package
 *     never produced a webhook). The reconciler (services/payaza-reconcile.ts)
 *     asks Payaza about every reference still awaiting payment and confirms it
 *     through the same confirmPayazaReference path.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { parseFulfillmentReference, resolveFulfillmentTenant } from '../../services/payment-fulfillers.js';
import { probeKeys, verifyPayazaSignature, type PayazaMode } from '../../services/payaza.js';
import { confirmPayazaReference, PayazaQueryFailed } from '../../services/payaza-confirm.js';

const MAX_REFERENCE_LENGTH = 200;
const WEBHOOK_BODY_LIMIT = 64 * 1024;

/** Where the tenant points Payaza (Settings -> Developers -> Webhooks), from the API's public URL. */
export function payazaWebhookUrl(): string {
    return `${(config.apiPublicUrl ?? '').replace(/\/+$/, '')}/payments/payaza/webhook`;
}

const KEY = z.string().trim().min(8).max(200).regex(/^\S+$/, 'must not contain spaces');
const connectSchema = z.object({
    publicKey: KEY,
    secretKey: KEY,
    mode: z.enum(['TEST', 'LIVE']),
});

/**
 * Payaza keys carry their mode (e.g. PZ78-PKLIVE-..., PZ78-PKTEST-...). When
 * a key says which mode it is, it must match the chosen one: a test key in
 * LIVE mode would fail every call, and a live key in TEST mode is a mistake
 * waiting to take real money on a "test" page. Keys without a marker pass.
 */
export function payazaKeyModeProblem(publicKey: string, secretKey: string, mode: PayazaMode): string | null {
    if (publicKey === secretKey) return 'The public key and the secret key are the same. Paste each from Payaza.';
    const markerOf = (k: string): PayazaMode | null => (/[PS]KTEST/i.test(k) ? 'TEST' : /[PS]KLIVE/i.test(k) ? 'LIVE' : null);
    for (const [label, key] of [['public', publicKey], ['secret', secretKey]] as const) {
        const marker = markerOf(key);
        if (marker && marker !== mode) {
            return `That ${label} key is a Payaza ${marker} key but you chose ${mode} mode. Use the ${mode === 'LIVE' ? 'Live' : 'Test'} keys, or switch the mode.`;
        }
    }
    return null;
}

interface PayazaWebhookBody {
    merchant_reference?: unknown;
    transaction_reference?: unknown;
    status?: unknown;
    transaction_status?: unknown;
    amount_validation?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Payaza's collection webhook: `status` Completed|Failed; older payloads only carry transaction_status. */
function isCompleted(body: PayazaWebhookBody): boolean {
    const status = str(body.status);
    if (status) return status.toLowerCase() === 'completed';
    return ['completed', 'funds received'].includes(str(body.transaction_status).toLowerCase());
}

const payazaRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/connect', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:payaza-connect`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect payments');
        }
        const parsed = connectSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
            throw fastify.httpErrors.badRequest('Paste your Payaza public key and secret key, and choose Test or Live.');
        }
        const { publicKey, secretKey, mode } = parsed.data;
        const problem = payazaKeyModeProblem(publicKey, secretKey, mode);
        if (problem) throw fastify.httpErrors.badRequest(problem);

        // Only the public key can be probed: Payaza uses the secret for nothing but signing webhooks.
        const probe = await probeKeys(publicKey, mode);
        if (probe === 'invalid') {
            throw fastify.httpErrors.badRequest(`Payaza rejected the public key for ${mode === 'LIVE' ? 'Live' : 'Test'} mode. Check the key and the mode.`);
        }
        if (probe === 'unknown') {
            request.log.warn({ tenantId: request.user.tenantId }, 'Payaza key probe inconclusive; storing the keys anyway');
        }

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { payazaPublicKey: encrypt(publicKey), payazaSecretKey: encrypt(secretKey), payazaMode: mode },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'payments.payaza_connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { mode, publicKeyPrefix: publicKey.slice(0, 12) },
            ipAddress: request.ip,
        });
        return { success: true, mode, webhookUrl: payazaWebhookUrl() };
    });

    fastify.post('/disconnect', { preHandler: [fastify.authenticate] }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can disconnect payments');
        }
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { paymentProvider: true },
        });
        // Leaving PAYAZA selected with no keys would make every new link fail; Paystack is the default.
        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { payazaPublicKey: null, payazaSecretKey: null, paymentProvider: 'PAYSTACK' },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'payments.payaza_disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { providerWas: tenant?.paymentProvider ?? 'PAYSTACK' },
            ipAddress: request.ip,
        });
        return { disconnected: true, provider: 'PAYSTACK' };
    });

    // Rate-limit excluded like the Paystack webhook: delivery is not per-tenant and a 429 loses a payment.
    // A small body limit instead: Payaza's notification is ~1 KB, and every request costs an HMAC.
    fastify.post('/webhook', { bodyLimit: WEBHOOK_BODY_LIMIT, config: { rateLimit: false } }, async (request, reply) => {
        const rawBody = (request as any).rawBody as Buffer | undefined;
        const header = request.headers['x-payaza-signature'];
        const signature = Array.isArray(header) ? header[0] : header;
        const body = (request.body ?? {}) as PayazaWebhookBody;

        const reference = str(body.merchant_reference) || str(body.transaction_reference);
        if (!reference || reference.length > MAX_REFERENCE_LENGTH) {
            return reply.code(200).send({ ignored: 'missing_reference' });
        }

        // 1-2. Ours? Whose? Both from our own data, before any key is chosen.
        const parsed = parseFulfillmentReference(reference);
        const tenantId = parsed ? await resolveFulfillmentTenant(fastify.prisma, parsed.kind, parsed.entityId) : null;
        if (!parsed || !tenantId) {
            // Not authenticated (no tenant, so no key), so no alert: anyone could send these.
            request.log.info({ reference: reference.slice(0, 100) }, 'Payaza webhook for a reference that is not ours');
            return reply.code(200).send({ ignored: 'unknown_reference' });
        }

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, payazaPublicKey: true, payazaSecretKey: true, payazaMode: true },
        });
        if (!tenant?.payazaSecretKey || !tenant.payazaPublicKey) {
            request.log.warn({ tenantId }, 'Payaza webhook for a tenant with no Payaza keys');
            throw fastify.httpErrors.unauthorized('Invalid Payaza signature');
        }
        if (!verifyPayazaSignature(rawBody, signature, decrypt(tenant.payazaSecretKey))) {
            request.log.warn({ tenantId, hasSignature: !!signature }, 'Payaza webhook signature mismatch');
            throw fastify.httpErrors.unauthorized('Invalid Payaza signature');
        }

        // 3. Only a completed collection can pay for anything.
        if (!isCompleted(body)) {
            return reply.code(200).send({ ignored: `status_${(str(body.status) || str(body.transaction_status) || 'unknown').slice(0, 40)}` });
        }
        const validation = str(body.amount_validation);
        if (validation && validation.toUpperCase() !== 'EXACT') {
            // Informational: the fulfiller decides from the status query's amount and its own row.
            request.log.warn({ tenantId, reference, amountValidation: validation.slice(0, 20) }, 'Payaza reports a non-exact amount');
        }

        // 4. Same path as the reconciler (services/payaza-confirm.ts): status query, fulfiller, unattributed report.
        let result;
        try {
            result = await confirmPayazaReference(
                { prisma: fastify.prisma, log: request.log },
                { tenant, reference, source: 'webhook', owned: parsed },
            );
        } catch (err) {
            if (err instanceof PayazaQueryFailed) throw fastify.httpErrors.badGateway('Payaza status query failed');
            throw err;
        }
        if (result.outcome !== 'dispatched') return reply.code(200).send({ ignored: result.outcome });
        return reply.code(200).send(result.body);
    });
};

export default payazaRoutes;
