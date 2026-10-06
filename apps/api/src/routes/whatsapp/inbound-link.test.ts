/**
 * Inbound customer linking trusts only a phone the PROVIDER vouches for. On
 * WhatsApp the number is the sender's, verified by Meta. On Instagram and
 * Messenger it is whatever the customer typed, so linking by it would attach
 * this chat to another person's customer record (their name and history).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveCustomerIdSafe = vi.fn(async () => 'cust1');
const linkConversationToCustomer = vi.fn(async () => true);
vi.mock('../../services/customers.js', () => ({
    resolveCustomerIdSafe: (...a: unknown[]) => (resolveCustomerIdSafe as any)(...a),
    linkConversationToCustomer: (...a: unknown[]) => (linkConversationToCustomer as any)(...a),
}));

import { linkCustomerOnInbound } from './inbound-events.js';

const fastify = { prisma: {}, log: { warn: vi.fn() } };
const tenant = { id: 't1', whatsappDisplayNumber: null };

beforeEach(() => {
    resolveCustomerIdSafe.mockClear();
    linkConversationToCustomer.mockClear();
});

describe('linkCustomerOnInbound', () => {
    it('links a WhatsApp conversation by its verified number', async () => {
        const conv = { id: 'c1', customerPhone: '233241234567' };
        expect(await linkCustomerOnInbound(fastify, tenant, conv, 'WHATSAPP')).toBe('cust1');
        expect(linkConversationToCustomer).toHaveBeenCalled();
    });

    it.each(['INSTAGRAM', 'MESSENGER'] as const)('never links a %s conversation by a typed number', async (channel) => {
        const conv = { id: 'c1', customerPhone: '233241234567' };
        expect(await linkCustomerOnInbound(fastify, tenant, conv, channel)).toBeNull();
        expect(resolveCustomerIdSafe).not.toHaveBeenCalled();
        expect(linkConversationToCustomer).not.toHaveBeenCalled();
    });

    it('keeps an existing link on any channel', async () => {
        const conv = { id: 'c1', customerPhone: '233241234567', customerId: 'old' };
        expect(await linkCustomerOnInbound(fastify, tenant, conv, 'INSTAGRAM')).toBe('old');
    });
});
