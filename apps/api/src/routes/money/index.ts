import { raiseAlert } from '../../services/alerts.js';
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { encrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { maskPhone } from '../../services/contact-privacy.js';
import { createNotification } from '../../services/notifications.js';
import { deriveBalances, readWalletCurrency } from '../../services/ledger.js';
import {
    initiateTransfer,
    markPayoutFailed,
    markPayoutProcessing,
    reportTransferUncertain,
    TransferRejectedError,
    TransferUncertainError,
} from '../../services/payout-transfer.js';
import {
    createWithdrawal,
    refusalMessage,
    WithdrawalConflictError,
    WithdrawalRefusedError,
} from '../../services/payout-request.js';
import { isPayoutsPaused } from '../../services/platform-switches.js';
import { checkStepUp } from '../../services/payout-stepup.js';
import {
    defaultPreviewGuard,
    previewAccountName,
    PreviewRateLimitedError,
} from '../../services/payout-preview.js';
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
interface PasswordRefusal {
    status: 400 | 403 | 429;
    code: 'PASSWORD_REQUIRED' | 'PASSWORD_INCORRECT' | 'PASSWORD_LOCKED';
    message: string;
    retryAfterSec?: number;
}

const moneyRoutes: FastifyPluginAsync = async (fastify) => {
    function requireOwner(request: { user: { role: string } }) {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the account owner can manage money');
        }
    }

    /**
     * Step-up: the owner re-enters their password for the two actions that move
     * money out (withdraw, change destination). A stolen session alone is then
     * not enough. A wrong attempt is audited (never the password itself) and
     * counts against the route's rate limit AND a per-user lockout.
     *
     * Password problems are the ONLY errors that carry a `PASSWORD_*` code, so
     * the apps can tell "type the password again" from every other 400 (a
     * withdrawal refusal, a failed reversal) without matching on prose:
     *   400 PASSWORD_REQUIRED   no password was sent
     *   403 PASSWORD_INCORRECT  wrong password (or an inactive user)
     *   429 PASSWORD_LOCKED     too many wrong passwords; try again later
     * The error-handler plugin drops `code`, so these are sent directly.
     */
    async function requireStepUp(
        request: { user: { userId: string; tenantId: string }; ip: string },
        password: unknown,
        action: 'withdraw' | 'destination_change',
    ): Promise<PasswordRefusal | null> {
        const result = await checkStepUp(fastify.prisma, {
            tenantId: request.user.tenantId,
            userId: request.user.userId,
            password,
            redis: fastify.redis ?? null,
        });
        if (result.ok) return null;
        await audit({
            prisma: fastify.prisma,
            action: result.reason === 'locked' ? 'money.step_up_locked' : 'money.step_up_failed',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { for: action },
            ipAddress: request.ip,
        });
        if (result.reason === 'locked') {
            return {
                status: 429,
                code: 'PASSWORD_LOCKED',
                message: 'Too many wrong passwords. For your safety, try again in about 15 minutes.',
                retryAfterSec: result.retryAfterSec,
            };
        }
        return { status: 403, code: 'PASSWORD_INCORRECT', message: 'That password is not right. Enter the password you sign in with.' };
    }

    function sendPasswordRefusal(reply: FastifyReply, r: PasswordRefusal) {
        if (r.retryAfterSec) reply.header('Retry-After', String(r.retryAfterSec));
        return reply.code(r.status).send({
            statusCode: r.status,
            error: r.status === 429 ? 'Too Many Requests' : r.status === 403 ? 'Forbidden' : 'Bad Request',
            code: r.code,
            message: r.message,
        });
    }

    const hasPassword = (body: unknown): boolean =>
        typeof (body as { password?: unknown } | null)?.password === 'string'
        && ((body as { password: string }).password.length > 0);

    /**
     * Give back a payout that was DEFINITELY not sent (Paystack refused it, or
     * we never asked). Never tells the owner the money is back when it isn't:
     * a failed reversal pages a human instead and returns false.
     */
    async function reverseUnsentPayout(payoutId: string, tenantId: string, failureReason: string): Promise<boolean> {
        try {
            await markPayoutFailed({
                prisma: fastify.prisma,
                payoutId,
                tenantId,
                failureReason,
                logger: fastify.log,
            });
            return true;
        } catch (reverseErr) {
            fastify.log.error({ err: reverseErr, payoutId }, 'Reversal of an unsent payout FAILED');
            await raiseAlert(fastify.prisma, {
                kind: 'payout.reversal_failed',
                severity: 'critical',
                tenantId,
                message: 'An unsent payout could not be returned to the balance — reconcile by hand.',
                context: { payoutId },
                dedupeKey: `payout.reversal_failed:${payoutId}`,
            });
            return false;
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

        // Read-only: a GET never creates a wallet. No wallet yet means zero
        // balances (deriveBalances sums an empty ledger) in the tenant's currency.
        const wallet = await readWalletCurrency(fastify.prisma, tenantId);
        const balances = await deriveBalances(fastify.prisma, tenantId, wallet.currency);

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
            const { currency } = await readWalletCurrency(fastify.prisma, request.user.tenantId);
            return { providers: await listMomoProviders(platformKey(), currency) };
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
    }, async (request, reply) => {
        requireOwner(request);
        const body = z.object({
            accountNumber: z.string().min(6).max(20),
            provider: z.string().min(2).max(20),
        }).parse(request.body);

        // Per-tenant quota plus a short cache: this resolves ANY number to a
        // name on Bookly's shared key, so it must not be a free lookup service.
        try {
            const accountName = await previewAccountName({
                guard: defaultPreviewGuard,
                tenantId: request.user.tenantId,
                accountNumber: body.accountNumber.replace(/\D/g, ''),
                provider: body.provider,
                resolve: (number, provider) => resolveAccountName(platformKey(), number, provider),
                redis: fastify.redis ?? null,
            });
            return { accountName };
        } catch (err) {
            if (err instanceof PreviewRateLimitedError) {
                reply.header('Retry-After', String(err.retryAfterSec));
                throw fastify.httpErrors.tooManyRequests(
                    err.scope === 'platform'
                        ? 'Number checks are very busy right now. Please try again in a little while.'
                        : 'You have checked a lot of numbers. Please wait a few minutes and try again.',
                );
            }
            throw err;
        }
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
    }, async (request, reply) => {
        requireOwner(request);
        const tenantId = request.user.tenantId;

        const body = z.object({
            accountNumber: z.string().min(6).max(20),
            provider: z.string().min(2).max(20),
            /** The owner's own name, used if the network cannot resolve one. */
            accountName: z.string().min(2).max(100).optional(),
            /** Step-up: the account password, re-entered. */
            password: z.string().min(1).max(200),
        }).safeParse(request.body);
        if (!body.success) {
            if (!hasPassword(request.body)) {
                return sendPasswordRefusal(reply, { status: 400, code: 'PASSWORD_REQUIRED', message: 'Enter your password to confirm.' });
            }
            throw fastify.httpErrors.badRequest('Check the number and network you entered.');
        }
        const input = body.data;
        const refusal = await requireStepUp(request, input.password, 'destination_change');
        if (refusal) return sendPasswordRefusal(reply, refusal);

        const digits = input.accountNumber.replace(/\D/g, '');

        const existing = await fastify.prisma.payoutRecipient.findFirst({
            where: { tenantId, archivedAt: null },
            select: { id: true },
        });
        const isReplacement = !!existing;

        // The recipient is registered in the WALLET currency: a payout is only
        // ever sent in the currency it was reserved in.
        const { currency } = await readWalletCurrency(fastify.prisma, tenantId);

        let recipient;
        try {
            recipient = await createTransferRecipient({
                secretKey: platformKey(),
                name: input.accountName ?? 'Bookly payout',
                accountNumber: digits,
                bankCode: input.provider,
                currency,
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
                    bankCode: input.provider,
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
                provider: input.provider,
                isReplacement,
            },
            ipAddress: request.ip,
        });

        // Telling the owner is the control that actually catches a takeover —
        // the cooling-off only buys time if somebody notices. A FIRST
        // destination is announced too: on an account nobody has used, the
        // first number is exactly where an attacker's money would go.
        await createNotification(fastify.prisma, {
            tenantId,
            type: 'SYSTEM',
            title: isReplacement ? 'Your payout number changed' : 'A payout number was added',
            message: isReplacement
                ? `Money will now go to ${saved.accountNumberMasked}. If this was not you, contact support immediately.`
                : `Withdrawals will go to ${saved.accountNumberMasked}. If this was not you, contact support immediately.`,
            metadata: { masked: saved.accountNumberMasked, isReplacement },
        }, fastify.log).catch(() => undefined);

        return {
            success: true,
            destination: { ...saved, usable: destinationIsUsable({ usableFrom, archivedAt: null }) },
            // Said plainly so the UI can explain the wait rather than look broken.
            coolingOffHours: isReplacement ? COOLING_OFF_HOURS : 0,
        };
    });

    // POST /money/withdraw — send money to the owner's Mobile Money.
    //
    // Reserves the funds and records the request. Actually sending it is a
    // separate step, so a provider failure returns the money without having
    // to unpick a half-written ledger.
    fastify.post('/withdraw', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 hour',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:withdraw`,
            },
        },
    }, async (request, reply) => {
        requireOwner(request);
        const tenantId = request.user.tenantId;

        const parsed = z.object({
            // Minor units, so no float ever reaches the ledger. The client
            // converts, and the value must be a whole number of pesewas.
            amountMinor: z.number().int().positive(),
            /** Step-up: the account password, re-entered. */
            password: z.string().min(1).max(200),
        }).safeParse(request.body);
        if (!parsed.success) {
            if (!hasPassword(request.body)) {
                return sendPasswordRefusal(reply, { status: 400, code: 'PASSWORD_REQUIRED', message: 'Enter your password to confirm.' });
            }
            throw fastify.httpErrors.badRequest('Enter a valid amount to withdraw.');
        }
        const body = parsed.data;
        const refusal = await requireStepUp(request, body.password, 'withdraw');
        if (refusal) return sendPasswordRefusal(reply, refusal);

        try {
            const created = await createWithdrawal({
                prisma: fastify.prisma,
                tenantId,
                requestedByUserId: request.user.userId,
                amountMinor: body.amountMinor,
                logger: fastify.log,
            });

            // Hand it to Paystack. A failure here returns the money rather
            // than leaving it stranded in PAYOUT_PENDING with nothing moving.
            let transfer: { transferCode: string };
            try {
                // The switch is checked again at the send: an admin pause must
                // bite even for a payout requested a moment before it. Unable
                // to read it counts as paused. Nothing has been sent, so
                // returning the reservation is exact, not a guess.
                let pause: { paused: boolean; reason?: string };
                try {
                    pause = await isPayoutsPaused(fastify.prisma, tenantId);
                } catch (switchErr) {
                    fastify.log.error({ err: switchErr, tenantId }, 'Could not read the payout switch at the send step');
                    pause = { paused: true };
                }
                if (pause.paused) {
                    if (pause.reason) fastify.log.warn({ tenantId, reason: pause.reason }, 'Payout not sent: payouts paused');
                    const reversed = await reverseUnsentPayout(created.payoutId, tenantId, 'Withdrawals were paused before this could be sent.');
                    throw fastify.httpErrors.badRequest(
                        `${refusalMessage('payouts_paused')} ${reversed
                            ? 'This request was cancelled and the money is back in your balance.'
                            : 'We are checking your balance, so please do not try again yet.'}`,
                    );
                }

                // EXACTLY the recipient createWithdrawal validated (usable,
                // past cooling-off), not whatever the latest one is now. A
                // destination changed since would otherwise be paid with the
                // old one's approval.
                transfer = await initiateTransfer({
                    secretKey: platformKey(),
                    recipientCode: created.recipientCode,
                    amountMinor: created.amountMinor,
                    currency: created.currency,
                    // Our payout id, so the webhook finds the request again
                    // without trusting anything the provider echoes back.
                    reference: created.payoutId,
                });
            } catch (err) {
                // Only give the money back when Paystack definitively refused.
                if (err instanceof TransferRejectedError) {
                    fastify.log.warn({ err, payoutId: created.payoutId }, 'Transfer rejected by Paystack');
                    const reversed = await reverseUnsentPayout(
                        created.payoutId,
                        tenantId,
                        'We could not send the transfer. Your money is back in your balance.',
                    );
                    throw fastify.httpErrors.badGateway(
                        reversed
                            ? 'We could not send that right now. Your money is back in your balance — please try again.'
                            : 'We could not send that right now. We are checking your balance — please do not try again yet.',
                    );
                }

                // Already an HTTP answer chosen above (the pause).
                if (typeof (err as { statusCode?: unknown })?.statusCode === 'number') throw err;

                // Page a human: this payout needs reconciling against Paystack.
                if (err instanceof TransferUncertainError) {
                    await reportTransferUncertain({
                        prisma: fastify.prisma,
                        tenantId,
                        payoutId: created.payoutId,
                        detail: err.detail,
                    }).catch(() => undefined);
                }

                // Anything else — a timeout, a 5xx, a reply we could not read
                // — leaves it genuinely unknown whether the transfer was
                // accepted. Returning the funds here would pay twice: once
                // into their MoMo and once back into their balance. So the
                // payout stays in flight and the webhook settles it.
                fastify.log.error(
                    { err, payoutId: created.payoutId },
                    'Transfer outcome UNKNOWN — leaving payout in flight, do not reverse',
                );
                throw fastify.httpErrors.gatewayTimeout(
                    'We could not confirm that transfer. We are checking with the network — do not try again yet, your withdrawal may still be on its way.',
                );
            }

            // Paystack accepted it. Record that through the guarded transition
            // (REQUESTED -> PROCESSING only, so a webhook that already settled
            // it is never dragged back). A failure here must not reverse or
            // alarm anyone: the money IS on its way and the webhook settles it.
            await markPayoutProcessing({
                prisma: fastify.prisma,
                tenantId,
                payoutId: created.payoutId,
                transferCode: transfer.transferCode,
            }).catch((err) =>
                fastify.log.error({ err, payoutId: created.payoutId }, 'Transfer accepted but the status write failed; the webhook will settle it'),
            );

            await audit({
                prisma: fastify.prisma,
                action: 'money.withdrawal_requested',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId,
                metadata: {
                    payoutId: created.payoutId,
                    amountMinor: created.amountMinor,
                    currency: created.currency,
                    recipientId: created.recipientId,
                },
                ipAddress: request.ip,
            });

            return {
                success: true,
                payoutId: created.payoutId,
                amountMinor: created.amountMinor,
                currency: created.currency,
                // Set expectations out loud: silence after a money action
                // reads as theft.
                message: 'On the way. Mobile Money usually arrives within a few minutes.',
            };
        } catch (err) {
            if (err instanceof WithdrawalRefusedError) {
                // A refusal is the owner's answer, not an error to swallow.
                throw fastify.httpErrors.badRequest(err.message);
            }
            if (err instanceof WithdrawalConflictError) {
                throw fastify.httpErrors.conflict(err.message);
            }
            // The transfer branch above already chose its answer (502
            // rejected, 504 outcome unknown). Flattening that into "nothing
            // has left your balance — try again" is false in the unknown case
            // and invites a second, double-paying withdrawal.
            if (typeof (err as { statusCode?: unknown })?.statusCode === 'number') {
                throw err;
            }
            fastify.log.error({ err, tenantId }, 'Withdrawal failed unexpectedly');
            // Unknown failure — possibly after the transfer was accepted (e.g.
            // the audit write). Don't promise the money is untouched.
            throw fastify.httpErrors.internalServerError(
                'We could not confirm that withdrawal. Check your balance before trying again.',
            );
        }
    });
};

export default moneyRoutes;
