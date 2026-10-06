/**
 * Process-wide handle that lets publishEvent nudge delivery without importing
 * Fastify or BullMQ. index.ts installs it at boot; where it is absent (tests,
 * scripts) the nudge is a no-op and the sweeper delivers within SWEEP_EVERY_MS.
 */
export type DeliveryDispatcher = (deliveryId: string, delayMs: number) => Promise<void>;

let current: DeliveryDispatcher | null = null;

export function setDeliveryDispatcher(fn: DeliveryDispatcher | null): void {
    current = fn;
}

/** Best-effort: never throws. */
export async function nudgeDeliveries(ids: string[], delayMs: number): Promise<void> {
    const d = current;
    if (!d) return;
    await Promise.all(ids.map((id) => d(id, delayMs).catch(() => undefined)));
}
