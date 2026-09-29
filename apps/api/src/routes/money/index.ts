import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { encrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { maskPhone } from '../../services/contact-privacy.js';
import { createNotification } from '../../services/notifications.js';
import { deriveBalances, ensureWallet } from '../../services/ledger.js';
import {
    coolingOffUntil,
    createTransferRecipient,
    destinationIsUsable,
    listMomoProviders,
    resolveAccountName,
    COOLING_OFF_HOURS,
} from '../../services/payout-recipient.js';

/**
 * The owner's money: what they have, and where it goes.
 *
 * Everything here is OWNER-only. Staff can run the whole business from the
 * dashboard, but moving money out — or changing where it lands — is the one
 * capability that never belongs to an employee.
 */
const moneyRoutes: FastifyPluginAsync = async (fastify) => {
    function requireOwner(request: { user: { role: string } }) {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the account owner can manage money');
        }
    }

    function platformKey(): string {
        const key = config.platformPaystack?.secretKey;
        if (!key) {
            throw fastify.httpErrors.serviceUnavailable(
                'Payouts are not available yet. Please try again later.',
            );
        }
        return key;
    }

    // GET /money — the whole Money screen in one call.
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
        requireOwner(request);
        const tenantId = request.user.tenantId;

        const wallet = await ensureWallet(fastify.prisma, tenantId);
        const balances = await deriveBalances(fastify.prisma, tenantId);

        const destination = await fastify.prisma.payoutRecipient.findFirst({
            where: { tenantId, archivedAt: null },
            orderBy: { createdAt: 'desc' },
        });

        const recentPayouts = await fastify.prisma.payoutRequest.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                amountMinor: true,
                currency: true,
                status: true,
                failureReason: true,
                createdAt: true,
                settledAt: true,
            },
        });

        const usable = destinationIsUsable(destination, new Date());

        return {
            currency: wallet.currency,
            // Named for what they mean, not what the ledger calls them.
            readyToWithdrawMinor: balances.availableMinor,
            stillClearingMinor: balances.pendingMinor,
            onTheWayMinor: balances.payoutPendingMinor,
            destination: destination
                ? {
                    id: destination.id,
                    accountName: destination.accountName,
                    accountNumberMasked: destination.accountNumberMasked,
                    provider: destination.bankCode,
                    usable,
                    usableFrom: destination.usableFrom,
                }
                : null,
            recentPayouts,
        };
    });

    // GET /money/providers — the Mobile Money networks we can pay to.
    fastify.get('/providers', { preHandler: [fastify.authenticate] }, async (request) => {
        requireOwner(request);
        try {
            return { providers: await listMomoProviders(platformKey()) };
        } catch (err) {
            fastify.log.error({ err }, 'Could not list mobile money providers');
            throw fastify.httpErrors.serviceUnavailable(
                'We could not load the mobile money networks. Please try again.',
            );
        }
    });

    // POST /money/destination/preview — whose account is this?
    // Separate from saving so the owner sees the name BEFORE committing. A
    // typo becomes a visibly wrong name instead of money sent to a stranger.
    fastify.post('/destination/preview', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '10 minutes',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:dest-preview`,
            },
        },
    }, async (request) => {
        requireOwner(request);
        const body = z.object({
            accountNumber: z.string().min(6).max(20),
            provider: z.string().min(2).max(20),
        }).parse(request.body);

        const accountName = await resolveAccountName(
            platformKey(),
            body.accountNumber.replace(/\D/g, ''),
            body.provider,
        );
        return { accountName };
    });

    // POST /money/destination — save where the money goes.
    fastify.post('/destination', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '1 hour',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:dest-save`,
            },
        },
    }, async (request) => {
        requireOwner(request);
        const tenantId = request.user.tenantId;

        const body = z.object({
            accountNumber: z.string().min(6).max(20),
            provider: z.string().min(2).max(20),
            /** The owner's own name, used if the network cannot resolve one. */
            accountName: z.string().min(2).max(100).optional(),
        }).parse(request.body);

        const digits = body.accountNumber.replace(/\D/g, '');

        const existing = await fastify.prisma.payoutRecipient.findFirst({
            where: { tenantId, archivedAt: null },
            select: { id: true },
        });
        const isReplacement = !!existing;

        let recipient;
        try {
            recipient = await createTransferRecipient({
                secretKey: platformKey(),
                name: body.accountName ?? 'Bookly payout',
                accountNumber: digits,
                bankCode: body.provider,
            });
        } catch (err) {
            fastify.log.error({ err, tenantId }, 'Could not register payout destination');
            throw fastify.httpErrors.badRequest(
                'That number was not accepted. Check it is correct and on the network you picked.',
            );
        }

        const usableFrom = coolingOffUntil({ isReplacement }, new Date());

        const saved = await fastify.prisma.$transaction(async (tx) => {
            // Only one live destination at a time — an old number the owner
            // replaced must never still be payable.
            if (existing) {
                await tx.payoutRecipient.updateMany({
                    where: { tenantId, archivedAt: null },
                    data: { archivedAt: new Date() },
                });
            }
            return tx.payoutRecipient.create({
                data: {
                    tenantId,
                    type: 'mobile_money',
                    accountName: recipient.accountName,
                    accountNumberEnc: encrypt(digits),
                    accountNumberMasked: maskPhone(digits),
                    bankCode: body.provider,
                    providerCode: recipient.recipientCode,
                    usableFrom,
                    isDefault: true,
                },
                select: {
                    id: true, accountName: true, accountNumberMasked: true,
                    bankCode: true, usableFrom: true,
                },
            });
        });

        await audit({
            prisma: fastify.prisma,
            action: 'money.destination_changed',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: {
                masked: saved.accountNumberMasked,
                provider: body.provider,
                isReplacement,
            },
            ipAddress: request.ip,
        });

        // Telling the owner is the control that actually catches a takeover —
        // the cooling-off only buys time if somebody notices.
        if (isReplacement) {
            await createNotification(fastify.prisma, {
                tenantId,
                type: 'SYSTEM',
                title: 'Your payout number changed',
                message: `Money will now go to ${saved.accountNumberMasked}. If this was not you, contact support immediately.`,
                metadata: { masked: saved.accountNumberMasked },
            }, fastify.log).catch(() => undefined);
        }

        return {
            success: true,
            destination: { ...saved, usable: destinationIsUsable({ usableFrom, archivedAt: null }) },
            // Said plainly so the UI can explain the wait rather than look broken.
            coolingOffHours: isReplacement ? COOLING_OFF_HOURS : 0,
        };
    });
};

export default moneyRoutes;
