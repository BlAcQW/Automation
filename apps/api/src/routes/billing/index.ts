import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { audit } from '../../services/audit.js';
import {
    getPlan,
    getPaystackPlanCode,
    isPlatformPaystackConfigured,
    PLAN_CATALOG,
    PLAN_IDS,
    type PlanId,
} from '../../services/plans.js';
import {
    evaluateSubscription,
    getQuotaState,
} from '../../services/usage.js';
import {
    ensurePaystackCustomer,
    initializeSubscriptionTransaction,
    disableSubscription,
    verifyPlatformWebhookSignature,
    PlatformPaystackError,
} from '../../services/paystack-platform.js';

const subscribeSchema = z.object({
    planId: z.enum(['starter', 'pro'] as const),
});

interface PlatformWebhookEvent {
    event?: string;
    data?: {
        reference?: string;
        next_payment_date?: string;
        customer?: { customer_code?: string };
        subscription?: {
            subscription_code?: string;
            email_token?: string;
            status?: string;
        };
        plan?: { plan_code?: string };
        metadata?: {
            tenantId?: string;
            planId?: PlanId;
            purpose?: string;
        };
        // For subscription.disable / .not_renew the event carries the codes
        // at the top level of data (not nested under .subscription).
        subscription_code?: string;
        email_token?: string;
    };
}

const billingRoutes: FastifyPluginAsync = async (fastify) => {
    // ---- authenticated tenant-facing routes ----

    // GET /billing/status — drives the Settings card.
    fastify.get('/status', { preHandler: fastify.authenticate }, async (request) => {
        const resolved = await evaluateSubscription(fastify.prisma, request.user.tenantId);
        const quota = await getQuotaState(fastify.prisma, request.user.tenantId, resolved.plan.id);

        return {
            plan: resolved.plan,
            subscription: {
                status: resolved.status,
                trialEndsAt: resolved.trialEndsAt,
                currentPeriodEnd: resolved.currentPeriodEnd,
            },
            usage: {
                messages: { used: quota.used, limit: quota.limit, ok: quota.ok },
                // Backward-compat field — the YYYY-MM-DD identifier of the
                // tenant's current 30-day cycle (Phase 4c).
                month: quota.cycleStart.toISOString().slice(0, 10),
                cycleStart: quota.cycleStart,
                cycleEnd: quota.cycleEnd,
            },
            availablePlans: Object.values(PLAN_CATALOG).sort(
                (a, b) => a.monthlyPrice - b.monthlyPrice,
            ),
            paystackConfigured: isPlatformPaystackConfigured(),
        };
    });

    // POST /billing/subscribe — initiate a Paystack subscription transaction.
    // The user is redirected to authorizationUrl to enter card details; on
    // successful charge the webhook flips the tenant to ACTIVE.
    fastify.post('/subscribe', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:billing-subscribe`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can change plan');
        }
        if (!isPlatformPaystackConfigured()) {
            throw fastify.httpErrors.serviceUnavailable(
                'Self-serve billing is not configured. Email support to change your plan.',
            );
        }

        const body = subscribeSchema.parse(request.body);
        const targetPlanCode = getPaystackPlanCode(body.planId);
        if (!targetPlanCode) {
            throw fastify.httpErrors.serviceUnavailable(
                `Paystack plan code for ${body.planId} is not configured`,
            );
        }

        const tenantId = request.user.tenantId;
        const resolved = await evaluateSubscription(fastify.prisma, tenantId);

        // For 4b, allow only Free→paid. Switching between Starter and Pro
        // mid-cycle requires proration which lands in Phase 4c.
        if (resolved.status === 'ACTIVE' && resolved.plan.id !== 'free' && resolved.plan.id !== body.planId) {
            throw fastify.httpErrors.badRequest(
                'Mid-cycle plan switches arrive in Phase 4c. Cancel your current plan first.',
            );
        }

        // Owner email for the Paystack customer record.
        const owner = await fastify.prisma.user.findFirst({
            where: { tenantId, role: 'OWNER', isActive: true },
            select: { email: true },
        });
        if (!owner?.email) {
            throw fastify.httpErrors.badRequest('Tenant owner email not found');
        }

        const targetPlan = getPlan(body.planId);
        const amountKobo = Math.round(targetPlan.monthlyPrice * 100);
        if (amountKobo <= 0) {
            throw fastify.httpErrors.badRequest('Target plan is free — nothing to charge');
        }

        try {
            await ensurePaystackCustomer({
                email: owner.email,
                metadata: { tenantId, source: 'bookingflow' },
            });
        } catch (err) {
            request.log.warn({ err }, 'ensurePaystackCustomer failed — proceeding with transaction init');
            // Paystack will create-or-reuse the customer at /transaction/initialize
            // time anyway. The dedicated /customer call is best-effort.
        }

        let result;
        try {
            result = await initializeSubscriptionTransaction({
                email: owner.email,
                amountKobo,
                planCode: targetPlanCode,
                reference: `bf_sub_${tenantId}_${Date.now()}`,
                callbackUrl: config.frontendUrl ? `${config.frontendUrl}/settings?billing=success` : undefined,
                metadata: {
                    tenantId,
                    planId: body.planId,
                    purpose: 'saas_subscription',
                },
            });
        } catch (err) {
            if (err instanceof PlatformPaystackError) {
                throw fastify.httpErrors.badGateway(err.message);
            }
            throw err;
        }

        await audit({
            prisma: fastify.prisma,
            action: 'subscription.initialize',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: {
                planId: body.planId,
                reference: result.reference,
                amountKobo,
            },
            ipAddress: request.ip,
        });

        return { authorizationUrl: result.authorizationUrl, reference: result.reference };
    });

    // POST /billing/cancel — disable Paystack subscription. Tenant keeps
    // the paid plan until currentPeriodEnd.
    fastify.post('/cancel', { preHandler: [fastify.authenticate] }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can cancel subscription');
        }

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: {
                subscriptionRef: true,
                subscriptionEmailToken: true,
                subscriptionStatus: true,
            },
        });
        if (!tenant?.subscriptionRef || !tenant.subscriptionEmailToken) {
            throw fastify.httpErrors.badRequest('No active subscription to cancel');
        }
        if (tenant.subscriptionStatus === 'CANCELLED') {
            return { cancelled: true, idempotent: true };
        }

        try {
            await disableSubscription({
                code: tenant.subscriptionRef,
                token: tenant.subscriptionEmailToken,
            });
        } catch (err) {
            if (err instanceof PlatformPaystackError) {
                request.log.warn({ err }, 'Paystack disable failed');
                throw fastify.httpErrors.badGateway(err.message);
            }
            throw err;
        }

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { subscriptionStatus: 'CANCELLED' },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'subscription.cancelled',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { via: 'self_serve' },
            ipAddress: request.ip,
        });

        return { cancelled: true };
    });

    // POST /billing/webhook — Paystack subscription events.
    // Verified against the PLATFORM secret (separate channel from
    // /payments/webhook which uses per-tenant secrets).
    fastify.post('/webhook', { config: { rateLimit: false } }, async (request, reply) => {
        const rawBody = (request as any).rawBody as Buffer | undefined;
        const signatureHeader = request.headers['x-paystack-signature'];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

        if (!verifyPlatformWebhookSignature(rawBody, signature)) {
            request.log.warn('Platform Paystack webhook signature mismatch');
            throw fastify.httpErrors.unauthorized('Invalid signature');
        }

        const event = (request.body ?? {}) as PlatformWebhookEvent;
        const data = event.data ?? {};
        const tenantId = data.metadata?.tenantId;

        switch (event.event) {
            case 'charge.success': {
                // Only consider SaaS-subscription charges. Tenant-customer
                // charges flow through /payments/webhook with the per-tenant
                // signature instead and have their own metadata.purpose.
                if (data.metadata?.purpose !== 'saas_subscription' || !tenantId) {
                    return reply.code(200).send({ ignored: 'not_saas_subscription' });
                }
                const planId = data.metadata.planId;
                if (!planId || !(PLAN_IDS as readonly string[]).includes(planId)) {
                    return reply.code(200).send({ ignored: 'unknown_plan' });
                }

                const periodEnd = data.next_payment_date
                    ? new Date(data.next_payment_date)
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                const updated = await fastify.prisma.tenant.update({
                    where: { id: tenantId },
                    data: {
                        planId,
                        subscriptionStatus: 'ACTIVE',
                        currentPeriodEnd: periodEnd,
                        subscriptionRef: data.subscription?.subscription_code ?? undefined,
                        subscriptionEmailToken: data.subscription?.email_token ?? undefined,
                        subscriptionCustomerCode: data.customer?.customer_code ?? undefined,
                    },
                });

                await audit({
                    prisma: fastify.prisma,
                    action: updated.subscriptionRef
                        ? 'subscription.renewed'
                        : 'subscription.activated',
                    actorType: 'SYSTEM',
                    tenantId,
                    metadata: {
                        planId,
                        reference: data.reference,
                        currentPeriodEnd: periodEnd.toISOString(),
                    },
                });

                return reply.code(200).send({ ok: true, action: 'activated_or_renewed' });
            }

            case 'invoice.payment_failed': {
                if (!tenantId && !data.subscription?.subscription_code) {
                    return reply.code(200).send({ ignored: 'no_tenant' });
                }
                const target = tenantId
                    ? { id: tenantId }
                    : { subscriptionRef: data.subscription!.subscription_code! };
                // Paystack may send tenantId in metadata or not — fall back
                // to lookup by subscriptionRef.
                const tenant = await fastify.prisma.tenant.findFirst({
                    where: target as any,
                    select: { id: true },
                });
                if (!tenant) {
                    return reply.code(200).send({ ignored: 'tenant_not_found' });
                }
                await fastify.prisma.tenant.update({
                    where: { id: tenant.id },
                    data: { subscriptionStatus: 'PAST_DUE' },
                });
                await audit({
                    prisma: fastify.prisma,
                    action: 'subscription.payment_failed',
                    actorType: 'SYSTEM',
                    tenantId: tenant.id,
                });
                return reply.code(200).send({ ok: true, action: 'past_due' });
            }

            case 'subscription.disable':
            case 'subscription.not_renew': {
                const subCode = data.subscription_code ?? data.subscription?.subscription_code;
                if (!subCode) {
                    return reply.code(200).send({ ignored: 'no_subscription_code' });
                }
                const tenant = await fastify.prisma.tenant.findFirst({
                    where: { subscriptionRef: subCode },
                    select: { id: true },
                });
                if (!tenant) {
                    return reply.code(200).send({ ignored: 'tenant_not_found' });
                }
                await fastify.prisma.tenant.update({
                    where: { id: tenant.id },
                    data: { subscriptionStatus: 'CANCELLED' },
                });
                await audit({
                    prisma: fastify.prisma,
                    action: 'subscription.cancelled',
                    actorType: 'SYSTEM',
                    tenantId: tenant.id,
                    metadata: { via: 'paystack_event', event: event.event },
                });
                return reply.code(200).send({ ok: true, action: 'cancelled' });
            }

            default:
                return reply.code(200).send({ ignored: `event_${event.event ?? 'unknown'}` });
        }
    });
};

export default billingRoutes;
