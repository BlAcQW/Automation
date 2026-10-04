/**
 * The money ledger.
 *
 * Customers pay into Bookly's Paystack account rather than each tenant's, so a
 * salon owner never has to create a gateway account or handle an API key. What
 * they earn is recorded here and paid out to their Mobile Money on request.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * A balance is never a number anyone edits. It is the sum of an append-only
 * log. `Wallet.cachedAvailableMinor` exists only so a dashboard can render
 * quickly; no debit is ever authorised against it.
 *
 * ACCOUNTS ANSWER ONE QUESTION: who owns this money right now. They do not
 * also record where it physically sits. Tracking both in one ledger needs
 * two-dimensional accounting, and the half-done version of that is where sign
 * errors hide. `EXTERNAL` is the world outside Bookly, which is what allows an
 * inbound payment to balance.
 *
 * Every movement sums to zero. Money is moved, never created.
 *
 *   Customer pays GHS 50, Bookly's fee GHS 1:
 *     EXTERNAL        -5000
 *     TENANT_PENDING  +4900
 *     PLATFORM_FEE     +100
 *
 * Amounts are INTEGER MINOR UNITS (pesewas) throughout. A float loses money to
 * rounding, and the loss is unrecoverable because nobody can say when it
 * happened.
 */

import type { LedgerAccount, LedgerReason, PrismaClient } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { scoped } from '../lib/logger.js';

export type AnyPrismaClient = PrismaClient | ExtendedPrismaClient;

/** One side of a movement. */
export interface LedgerLine {
    account: LedgerAccount;
    /** Signed, integer minor units. */
    amountMinor: number;
}

/**
 * Thrown whenever a movement would not conserve money, or an amount is not a
 * whole number of minor units. Always a programming error, never a user error
 * — it must surface loudly rather than being clamped or rounded away.
 */
/**
 * Thrown when a movement would leave a tenant owing more than they hold.
 *
 * `assertBalanced` only proves a movement conserves money — two movements can
 * each balance and still overdraw the same pot between them. This is the
 * backstop that turns that race into a rolled-back transaction rather than a
 * negative balance nobody notices.
 */
export class LedgerOverdrawError extends Error {
    constructor(account: string, resulting: number) {
        super(`ledger_overdraw: ${account} would become ${resulting}`);
        this.name = 'LedgerOverdrawError';
    }
}

export class LedgerImbalanceError extends Error {
    constructor(details: string) {
        super(`ledger_imbalance: ${details}`);
        this.name = 'LedgerImbalanceError';
    }
}

/** Total of the lines posted to one account. */
export function sumFor(lines: readonly LedgerLine[], account: LedgerAccount): number {
    return lines.filter((l) => l.account === account).reduce((t, l) => t + l.amountMinor, 0);
}

/**
 * Refuse anything that is not a conserving, whole-unit, multi-sided movement.
 *
 * Called by every builder below AND again before the rows are written, so a
 * hand-assembled movement cannot bypass it.
 */
export function assertBalanced(lines: readonly LedgerLine[]): void {
    if (lines.length < 2) {
        throw new LedgerImbalanceError(
            `a movement needs at least two sides, got ${lines.length}`,
        );
    }
    for (const l of lines) {
        if (!Number.isInteger(l.amountMinor)) {
            throw new LedgerImbalanceError(
                `amount ${l.amountMinor} on ${l.account} is not a whole minor unit`,
            );
        }
    }
    const total = lines.reduce((t, l) => t + l.amountMinor, 0);
    if (total !== 0) {
        throw new LedgerImbalanceError(`lines sum to ${total}, must be 0`);
    }
}

function requirePositive(amountMinor: number, what: string): void {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw new LedgerImbalanceError(`${what} must be a positive whole number of minor units`);
    }
}

/**
 * Bookly's cut of a payment, in minor units.
 *
 * `rateBps` is basis points (250 = 2.5%), so the rate itself is an integer and
 * no percentage ever touches a float. Rounds half up, and can never exceed the
 * amount being split.
 */
export function splitFee(amountMinor: number, rateBps: number): number {
    requirePositive(amountMinor, 'amount');
    if (!Number.isInteger(rateBps) || rateBps < 0) {
        throw new LedgerImbalanceError('fee rate must be a non-negative whole number of basis points');
    }
    return Math.min(amountMinor, Math.round((amountMinor * rateBps) / 10_000));
}

// ---------------------------------------------------------------------------
// Movement builders. Each returns the lines for one economic event.
// ---------------------------------------------------------------------------

/**
 * A customer's payment arrived.
 *
 * Lands in TENANT_PENDING, never straight to available. A booking deposit is
 * conditional money until the appointment happens: paying it out the same day
 * would mean Bookly funds every cancellation refund out of its own pocket.
 */
export function depositReceived(grossMinor: number, feeMinor: number): LedgerLine[] {
    requirePositive(grossMinor, 'payment amount');
    if (!Number.isInteger(feeMinor) || feeMinor < 0) {
        throw new LedgerImbalanceError('fee must be a non-negative whole number of minor units');
    }
    if (feeMinor > grossMinor) {
        throw new LedgerImbalanceError(`fee ${feeMinor} exceeds payment ${grossMinor}`);
    }

    const lines: LedgerLine[] = [
        { account: 'EXTERNAL', amountMinor: -grossMinor },
        { account: 'TENANT_PENDING', amountMinor: grossMinor - feeMinor },
    ];
    if (feeMinor > 0) lines.push({ account: 'PLATFORM_FEE', amountMinor: feeMinor });

    assertBalanced(lines);
    return lines;
}

/** The appointment passed (or the hold period elapsed): pending becomes withdrawable. */
export function fundsCleared(amountMinor: number): LedgerLine[] {
    requirePositive(amountMinor, 'amount');
    const lines: LedgerLine[] = [
        { account: 'TENANT_PENDING', amountMinor: -amountMinor },
        { account: 'TENANT_AVAILABLE', amountMinor: amountMinor },
    ];
    assertBalanced(lines);
    return lines;
}

/**
 * The owner asked to withdraw.
 *
 * Money leaves TENANT_AVAILABLE immediately, so a second concurrent request
 * cannot spend it again, but it is not yet gone — it waits in PAYOUT_PENDING
 * until the provider confirms.
 */
export function payoutRequested(amountMinor: number): LedgerLine[] {
    requirePositive(amountMinor, 'payout amount');
    const lines: LedgerLine[] = [
        { account: 'TENANT_AVAILABLE', amountMinor: -amountMinor },
        { account: 'PAYOUT_PENDING', amountMinor: amountMinor },
    ];
    assertBalanced(lines);
    return lines;
}

/** The provider confirmed the transfer: the money has left Bookly. */
export function payoutSettled(amountMinor: number): LedgerLine[] {
    requirePositive(amountMinor, 'payout amount');
    const lines: LedgerLine[] = [
        { account: 'PAYOUT_PENDING', amountMinor: -amountMinor },
        { account: 'EXTERNAL', amountMinor: amountMinor },
    ];
    assertBalanced(lines);
    return lines;
}

/** The transfer failed: put it back exactly where it came from. */
export function payoutReversed(amountMinor: number): LedgerLine[] {
    requirePositive(amountMinor, 'payout amount');
    const lines: LedgerLine[] = [
        { account: 'PAYOUT_PENDING', amountMinor: -amountMinor },
        { account: 'TENANT_AVAILABLE', amountMinor: amountMinor },
    ];
    assertBalanced(lines);
    return lines;
}

/**
 * Money went back to the customer.
 *
 * `from` says which of the tenant's buckets it comes out of — pending if the
 * appointment has not happened yet, available if it already cleared. The fee
 * is reversed too: Bookly does not keep a cut of a refunded booking.
 */
export function refundIssued(
    netMinor: number,
    feeMinor: number,
    from: 'TENANT_PENDING' | 'TENANT_AVAILABLE',
): LedgerLine[] {
    requirePositive(netMinor, 'refund amount');
    if (!Number.isInteger(feeMinor) || feeMinor < 0) {
        throw new LedgerImbalanceError('fee must be a non-negative whole number of minor units');
    }
    const lines: LedgerLine[] = [
        { account: from, amountMinor: -netMinor },
        { account: 'EXTERNAL', amountMinor: netMinor + feeMinor },
    ];
    if (feeMinor > 0) lines.push({ account: 'PLATFORM_FEE', amountMinor: -feeMinor });

    assertBalanced(lines);
    return lines;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface PostMovementArgs {
    tenantId: string;
    walletId: string;
    reason: LedgerReason;
    /**
     * Derived from the event, never generated per call — the provider's
     * transaction reference, the payout id, the booking id plus purpose. The
     * column is UNIQUE, so a replayed webhook or a double-tapped button is a
     * no-op at the database level rather than in an `if` that can lose a race.
     */
    idempotencyKey: string;
    lines: LedgerLine[];
    currency?: string;
    bookingId?: string | null;
    orderId?: string | null;
    payoutId?: string | null;
    note?: string | null;
}

/** True when this movement had already been recorded and was skipped. */
export interface PostMovementResult {
    movementId: string | null;
    duplicate: boolean;
}

/**
 * Write one movement and its lines atomically.
 *
 * Must be called inside a transaction by anything that also changes state
 * elsewhere (a payout row, a booking's payment status), so the ledger and that
 * state can never disagree after a crash.
 */
/**
 * Take an exclusive lock on the tenant's wallet row for the rest of the
 * transaction.
 *
 * Two movements that can spend the same pot must serialise on something, and
 * the wallet row is the natural choke point. Without it, a refund and a
 * clearing read the same pending balance and both act on it.
 *
 * Raw because Prisma has no `FOR UPDATE`. Scoped by the wallet id the caller
 * already resolved inside the tenant, so it grants no cross-tenant reach.
 */
export async function lockWallet(tx: AnyPrismaClient, walletId: string): Promise<void> {
    await (tx as unknown as {
        $queryRawUnsafe: (q: string, ...v: unknown[]) => Promise<unknown>;
    }).$queryRawUnsafe('SELECT id FROM "Wallet" WHERE id = $1 FOR UPDATE', walletId);
}

/** Pots that may never go negative — money the tenant is owed or is owed from. */
const NON_NEGATIVE_ACCOUNTS: LedgerAccount[] = [
    'TENANT_PENDING',
    'TENANT_AVAILABLE',
    'PAYOUT_PENDING',
];

export async function postMovement(
    tx: AnyPrismaClient,
    args: PostMovementArgs,
): Promise<PostMovementResult> {
    assertBalanced(args.lines);

    // Serialise every writer on this wallet before reading anything, so two
    // movements cannot each see the same balance and both spend it.
    await lockWallet(tx, args.walletId);

    const currency = args.currency ?? 'GHS';

    // The unique index on idempotencyKey is the guard. Checking first and then
    // inserting has a race between the two, and retry storms find it.
    try {
        const movement = await tx.ledgerMovement.create({
            data: {
                tenantId: args.tenantId,
                reason: args.reason,
                idempotencyKey: args.idempotencyKey,
                currency,
                bookingId: args.bookingId ?? null,
                orderId: args.orderId ?? null,
                payoutId: args.payoutId ?? null,
                note: args.note ?? null,
                entries: {
                    create: args.lines.map((l) => ({
                        walletId: args.walletId,
                        tenantId: args.tenantId,
                        account: l.account,
                        amountMinor: l.amountMinor,
                        currency,
                    })),
                },
            },
            select: { id: true },
        });
        // Re-derive AFTER writing, inside the same transaction. If this
        // movement overdrew a pot, throwing rolls the whole thing back — the
        // rows above included. A negative balance is always a bug, never
        // something to clamp away.
        const after = await deriveBalances(tx, args.tenantId);
        const resulting: Record<string, number> = {
            TENANT_PENDING: after.pendingMinor,
            TENANT_AVAILABLE: after.availableMinor,
            PAYOUT_PENDING: after.payoutPendingMinor,
        };
        for (const account of NON_NEGATIVE_ACCOUNTS) {
            if (resulting[account] < 0) {
                throw new LedgerOverdrawError(account, resulting[account]);
            }
        }

        return { movementId: movement.id, duplicate: false };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return { movementId: null, duplicate: true };
        }
        throw err;
    }
}

function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2002'
    );
}

export interface WalletBalances {
    availableMinor: number;
    pendingMinor: number;
    payoutPendingMinor: number;
}

/**
 * Derive balances from the ledger itself.
 *
 * This is the authority. The cached columns on `Wallet` are for rendering a
 * dashboard; a withdrawal re-derives from here, inside its own transaction.
 */
export async function deriveBalances(
    tx: AnyPrismaClient,
    tenantId: string,
): Promise<WalletBalances> {
    // Summed in JS rather than with groupBy: the tenant-guard `$extends`
    // widens the client enough that groupBy's overloads stop resolving, and a
    // raw query would bypass that guard entirely — not a trade worth making in
    // money code. Entry counts per tenant stay small (a few thousand after
    // years of trading); if that ever changes, add a periodic rollup rather
    // than reaching for raw SQL.
    const rows = await tx.ledgerEntry.findMany({
        where: { tenantId },
        select: { account: true, amountMinor: true },
    });

    const of = (account: LedgerAccount) =>
        rows.reduce((t: number, r: { account: LedgerAccount; amountMinor: number }) =>
            (r.account === account ? t + r.amountMinor : t), 0);

    return {
        availableMinor: of('TENANT_AVAILABLE'),
        pendingMinor: of('TENANT_PENDING'),
        payoutPendingMinor: of('PAYOUT_PENDING'),
    };
}

/** Refresh the cached figures after a movement. Never a source of truth. */
export async function refreshCachedBalances(
    tx: AnyPrismaClient,
    tenantId: string,
    walletId: string,
): Promise<WalletBalances> {
    const balances = await deriveBalances(tx, tenantId);
    await tx.wallet.update({
        where: { id: walletId },
        data: {
            cachedAvailableMinor: balances.availableMinor,
            cachedPendingMinor: balances.pendingMinor,
            lastReconciledAt: new Date(),
        },
    });
    return balances;
}

const log = scoped('ledger');
const FALLBACK_CURRENCY = 'GHS';

/**
 * Read-only: what currency a tenant's money screen should show. Never creates
 * a wallet — a GET must not write. With no wallet yet, the tenant's own
 * payment currency is the honest answer.
 */
export async function readWalletCurrency(
    tx: AnyPrismaClient,
    tenantId: string,
): Promise<{ walletExists: boolean; currency: string }> {
    const wallet = await tx.wallet.findUnique({ where: { tenantId }, select: { currency: true } });
    if (wallet) return { walletExists: true, currency: wallet.currency };
    const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { paymentCurrency: true },
    });
    return { walletExists: false, currency: tenant?.paymentCurrency ?? FALLBACK_CURRENCY };
}

/**
 * Get the tenant's wallet, creating it on first use (credit paths only).
 *
 * A new wallet takes `currency` if given, else the tenant's paymentCurrency.
 * An existing wallet's currency is never changed; a request for a different
 * currency is logged at error so the mismatch is visible, and the existing
 * wallet is returned unchanged.
 */
export async function ensureWallet(
    tx: AnyPrismaClient,
    tenantId: string,
    currency?: string,
): Promise<{ id: string; currency: string }> {
    const existing = await tx.wallet.findUnique({
        where: { tenantId },
        select: { id: true, currency: true },
    });
    if (existing) {
        if (currency && currency !== existing.currency) {
            log.error(
                { tenantId, walletId: existing.id, walletCurrency: existing.currency, requestedCurrency: currency },
                'Wallet currency mismatch: keeping the existing wallet currency',
            );
        }
        return existing;
    }

    const newCurrency = currency ?? (await readWalletCurrency(tx, tenantId)).currency;

    try {
        return await tx.wallet.create({
            data: { tenantId, currency: newCurrency },
            select: { id: true, currency: true },
        });
    } catch (err) {
        // Two first-ever payments landing together both try to create it.
        if (isUniqueViolation(err)) {
            const w = await tx.wallet.findUnique({
                where: { tenantId },
                select: { id: true, currency: true },
            });
            if (w) {
                if (w.currency !== newCurrency) {
                    log.error(
                        { tenantId, walletId: w.id, walletCurrency: w.currency, requestedCurrency: newCurrency },
                        'Wallet currency mismatch: keeping the existing wallet currency',
                    );
                }
                return w;
            }
        }
        throw err;
    }
}
