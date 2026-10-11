import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveCustomerIdSafe = vi.fn();
const linkConversationToCustomer = vi.fn();
vi.mock('../../services/customers.js', () => ({
    resolveCustomerIdSafe: (...a: unknown[]) => resolveCustomerIdSafe(...a),
    linkConversationToCustomer: (...a: unknown[]) => linkConversationToCustomer(...a),
}));
vi.mock('../../services/events/emit.js', () => ({ emitMessageReceived: vi.fn() }));

import { linkCustomerOnInbound } from './inbound-events.js';

const fastify: any = { prisma: {}, log: { warn: vi.fn() } };
const tenant = { id: 't1', whatsappDisplayNumber: '+233302000000' };

beforeEach(() => {
    resolveCustomerIdSafe.mockReset().mockResolvedValue('cust-1');
    linkConversationToCustomer.mockReset().mockResolvedValue(true);
});

describe('linkCustomerOnInbound with WhatsApp usernames', () => {
    it('never links a username-only (BSUID) chat by a number the customer typed', async () => {
        const conv = { id: 'c1', externalId: 'GH.1234567890123456', customerPhone: '+233201111111', customerId: null };
        expect(await linkCustomerOnInbound(fastify, tenant, conv, 'WHATSAPP')).toBeNull();
        expect(resolveCustomerIdSafe).not.toHaveBeenCalled();
    });

    it('still links a chat keyed by the Meta-verified phone', async () => {
        const conv = { id: 'c1', externalId: '233241234567', customerPhone: '233241234567', customerId: null };
        expect(await linkCustomerOnInbound(fastify, tenant, conv, 'WHATSAPP')).toBe('cust-1');
        expect(resolveCustomerIdSafe).toHaveBeenCalledTimes(1);
    });
});
