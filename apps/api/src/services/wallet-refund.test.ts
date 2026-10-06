import { describe, it, expect, vi, beforeEach } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
vi.mock('./paystack.js', () => ({ refundTransaction: vi.fn().mockRejectedValue(new Error('provider down')) }));
vi.mock('./collection-route.js', () => ({
    resolveCollectionRoute: vi.fn(() => ({ route: 'PLATFORM', secretKey: 'sk' })),
}));
vi.mock('./ledger.js', () => ({
    postMovement: vi.fn(), refreshCachedBalances: vi.fn(), refundIssued: vi.fn(),
}));
vi.mock('./wallet-clearing.js', () => ({ pendingFromEntries: vi.fn(() => 5000) }));

import { refundDepositForBooking } from './wallet-refund.js';

beforeEach(() => raise.mockClear());

describe('refundDepositForBooking provider failure', () => {
  it('raises a critical alert and releases the claim', async () => {
    const prisma: any = {
      booking: {
        findFirst: vi.fn().mockResolvedValue({ paymentStatus: 'PAID', paymentReference: 'ref1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', currency: 'GHS' }) },
      ledgerMovement: { findMany: vi.fn().mockResolvedValue([{ entries: [{ account: 'TENANT_PENDING', amountMinor: 5000 }] }]) },
      tenant: { findUnique: vi.fn().mockResolvedValue({}) },
    };
    const r = await refundDepositForBooking({ prisma, tenantId: 't1', bookingId: 'b1' });
    if (r.refunded === false && r.reason === 'provider_failed') {
      expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
        kind: 'refund.provider_failed', severity: 'critical', tenantId: 't1', dedupeKey: 'refund.provider_failed:b1',
      }));
    } else {
      throw new Error(`did not reach provider failure path: ${JSON.stringify(r)}`);
    }
  });
});
