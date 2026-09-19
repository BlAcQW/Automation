/**
 * Which deposit applies to a booking.
 *
 * The business decides whether deposits are required at all and what the
 * default is (Settings → Deposits). A service can override the amount; an
 * explicit 0 on a service means "this one needs no deposit" even when the
 * business default is on.
 */

export interface DepositPolicy {
    depositRequired: boolean;
    defaultDepositAmount: { toString(): string } | number | string | null | undefined;
}

export interface DepositServiceShape {
    depositAmount: { toString(): string } | number | string | null | undefined;
}

/** How long an unpaid hold keeps the slot before it is released. */
export const HOLD_MINUTES = 30;

/** Deposit in major units (e.g. 50 = GHS 50.00). 0 means none. */
export function effectiveDeposit(policy: DepositPolicy, service: DepositServiceShape): number {
    if (!policy.depositRequired) return 0;
    if (service.depositAmount !== null && service.depositAmount !== undefined) {
        return clamp(Number(service.depositAmount.toString()));
    }
    if (policy.defaultDepositAmount === null || policy.defaultDepositAmount === undefined) return 50;
    return clamp(Number(policy.defaultDepositAmount.toString()));
}

function clamp(n: number): number {
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}
