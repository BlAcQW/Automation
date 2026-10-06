/**
 * External app support (D2): a tenant's app hosted anywhere plugs into the
 * platform through three seams, all here.
 *
 *  1. CONFIG   One ExternalApp per tenant: a name, an inbound URL and a signing
 *     secret (encrypted at rest, shown once at creation / rotation).
 *  2. DELIVERY syncExternalAppSubscription keeps ONE managed WebhookSubscription
 *     (description 'external-app') mirroring that config, so the D3 delivery
 *     pipeline carries inbound messages (and the other events below) to the app,
 *     signed with the same secret. Deactivating or deleting the app switches the
 *     subscription off; it is never deleted, so delivery history survives.
 *  3. PAYMENTS The 'external_app' payment fulfiller turns a verified charge
 *     into a `payment.succeeded` event for the app.
 *
 * WHY NO SCHEMA FOR PAYMENTS. A payment link for an external app has no row of
 * ours to hold "what was owed": the app owns the entity. The webhook route has
 * already (a) verified the signature, (b) re-verified the transaction with the
 * tenant's own Paystack key and taken amount/currency FROM PAYSTACK, and (c)
 * cross-checked kind + entity + tenant against what Paystack stored at
 * initialisation. So the event carries Paystack's real figures and the app is
 * the one that compares `amountMinor` with what it expected (documented in
 * docs/API.md). The only party who could forge a charge is the tenant, on the
 * tenant's own gateway.
 *
 * IDEMPOTENCY. Paystack redelivers, possibly concurrently. The event is
 * published with publishEventOnce: DomainEvent @@unique([tenantId, dedupeKey])
 * (key `payment.succeeded:reference:<ref>`) makes the second insert fail with
 * P2002, which is 'already_applied'. Atomic, no JSON scan, no lock; the same key
 * flow payments use, so a reference can never produce two events across paths.
 */

import crypto from 'node:crypto';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { encrypt } from './crypto.js';
import { publishEventOnce } from './events/emit.js';
import {
    isRegisteredFulfillmentKind,
    registerPaymentFulfiller,
    type FulfillmentInput,
    type FulfillmentOutcome,
} from './payment-fulfillers.js';

type PrismaLike = ExtendedPrismaClient | any;

export const EXTERNAL_APP_FULFILLMENT_KIND = 'external_app';
export const EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION = 'external-app';

/** What an external app needs to run a conversation and take payment. */
export const EXTERNAL_APP_EVENTS = [
    'message.received',
    'conversation.handoff',
    'conversation.resumed',
    'payment.succeeded',
    'payment.failed',
    'flow.completed',
] as const;

export const MAX_ENTITY_REF_LENGTH = 100;
export const ENTITY_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

async function withAdvisoryLock<T>(prisma: PrismaLike, key: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        return fn(tx);
    });
}

// ---------------------------------------------------------------------------
// Payments

async function fulfillExternalAppPayment(input: FulfillmentInput): Promise<FulfillmentOutcome> {
    const { prisma, tenantId, entityId, reference, amountMinor, currency } = input;

    if (!ENTITY_REF_PATTERN.test(entityId ?? '')) return { status: 'rejected', reason: 'entity_ref_invalid' };
    if (!reference || reference.length > 200) return { status: 'rejected', reason: 'reference_invalid' };
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { status: 'rejected', reason: 'amount_invalid' };
    if (!/^[A-Za-z]{3}$/.test(currency ?? '')) return { status: 'rejected', reason: 'currency_invalid' };

    const result = await publishEventOnce(
        prisma,
        {
            tenantId,
            type: 'payment.succeeded',
            payload: {
                v: 1,
                entityRef: entityId,
                amountMinor,
                currency: currency.toUpperCase(),
                reference,
                // Catalogue field names (services/events/catalogue.ts), so a
                // consumer written against the catalogue works unchanged.
                paymentId: reference,
                amount: amountMinor,
            },
        },
        { field: 'reference', equals: reference },
    );
    return { status: result === 'duplicate' ? 'already_applied' : 'applied' };
}

/** Safe to call more than once (index.ts and the v1 plugin both do). */
export function registerExternalAppFulfiller(): void {
    if (isRegisteredFulfillmentKind(EXTERNAL_APP_FULFILLMENT_KIND)) return;
    registerPaymentFulfiller(EXTERNAL_APP_FULFILLMENT_KIND, fulfillExternalAppPayment);
}

// ---------------------------------------------------------------------------
// Delivery subscription

export async function syncExternalAppSubscription(prisma: PrismaLike, tenantId: string): Promise<void> {
    await withAdvisoryLock(prisma, `external-app-sub:${tenantId}`, async (tx) => {
        const where = { tenantId, description: EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION };
        const app = await tx.externalApp.findFirst({ where: { tenantId } });

        if (!app) {
            await tx.webhookSubscription.updateMany({ where, data: { isActive: false } });
            return;
        }

        const data = {
            url: app.url,
            secretEnc: app.signingSecretEnc,
            events: [...EXTERNAL_APP_EVENTS],
            isActive: app.isActive,
        };
        const { count } = await tx.webhookSubscription.updateMany({ where, data });
        if (count === 0) {
            await tx.webhookSubscription.create({
                data: { tenantId, description: EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION, ...data },
            });
        }
    });
}

// ---------------------------------------------------------------------------
// Config management

export interface ExternalAppView {
    name: string;
    url: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

function toView(row: ExternalAppView & Record<string, unknown>): ExternalAppView {
    return { name: row.name, url: row.url, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function newSigningSecret(): string {
    return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

export async function getExternalApp(prisma: PrismaLike, tenantId: string): Promise<ExternalAppView | null> {
    const row = await prisma.externalApp.findFirst({ where: { tenantId } });
    return row ? toView(row) : null;
}

export interface SaveExternalAppInput {
    name: string;
    url: string;
    isActive?: boolean;
}

/**
 * Create or update. `signingSecret` is present ONLY when this call created the
 * app: it is the one time the plaintext exists outside memory.
 */
export async function saveExternalApp(
    prisma: PrismaLike,
    tenantId: string,
    input: SaveExternalAppInput,
): Promise<{ app: ExternalAppView; signingSecret?: string }> {
    const existing = await prisma.externalApp.findFirst({ where: { tenantId } });

    if (!existing) {
        const signingSecret = newSigningSecret();
        try {
            const row = await prisma.externalApp.create({
                data: {
                    tenantId,
                    name: input.name,
                    url: input.url,
                    isActive: input.isActive ?? true,
                    signingSecretEnc: encrypt(signingSecret),
                },
            });
            await syncExternalAppSubscription(prisma, tenantId);
            return { app: toView(row), signingSecret };
        } catch (err) {
            // A concurrent first save won; treat this one as an update, and
            // discard our (never-shown) secret.
            if ((err as { code?: string }).code !== 'P2002') throw err;
        }
    }

    const data: Record<string, unknown> = { name: input.name, url: input.url };
    if (input.isActive !== undefined) data.isActive = input.isActive;
    await prisma.externalApp.updateMany({ where: { tenantId }, data });
    await syncExternalAppSubscription(prisma, tenantId);
    const row = await prisma.externalApp.findFirst({ where: { tenantId } });
    if (!row) throw new Error('External app vanished during update');
    return { app: toView(row) };
}

/** New secret, returned once; null when no app is configured. */
export async function rotateExternalAppSecret(prisma: PrismaLike, tenantId: string): Promise<string | null> {
    const existing = await prisma.externalApp.findFirst({ where: { tenantId } });
    if (!existing) return null;
    const signingSecret = newSigningSecret();
    await prisma.externalApp.updateMany({ where: { tenantId }, data: { signingSecretEnc: encrypt(signingSecret) } });
    await syncExternalAppSubscription(prisma, tenantId);
    return signingSecret;
}

export async function deleteExternalApp(prisma: PrismaLike, tenantId: string): Promise<void> {
    await prisma.externalApp.deleteMany({ where: { tenantId } });
    await syncExternalAppSubscription(prisma, tenantId);
}
