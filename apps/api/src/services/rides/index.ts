/**
 * RIDES pack (TURBO). Call registerRidesPack(prisma) at boot in every process
 * that runs flow turns or payment webhooks (API and worker): it registers the
 * ride_package / ride_payg payment kinds (fulfillers + link preparers) and the
 * turbo.* flow actions. Safe to call more than once.
 */
import type { RidesClient } from './db.js';
import { registerRidePayments } from './payments.js';
import { registerRideFlowActions } from './flow-actions.js';

export function registerRidesPack(prisma: RidesClient): void {
    registerRidePayments();
    registerRideFlowActions(prisma);
}

export { TURBO_FLOW_KEY, turboFoundingFlow } from './turbo-flow.js';
export { installTurboPack } from './install.js';
