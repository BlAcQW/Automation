import { describe, it, expect, vi } from 'vitest';
import { inboundSenderId, inboundSenderPhone, isWhatsAppPhoneId, whatsappDestination } from './whatsapp-identity.js';
import { buildTextRequest } from './channel-send.js';
import { isPhoneVerified } from './llm-shop-tools.js';
import { resolveConversationCustomer } from './rides/operations.js';
import { createRideFlowActions } from './rides/flow-actions.js';

const BSUID = 'GH.1234567890123456';

describe('whatsapp identity', () => {
    it('tells a phone from a BSUID', () => {
        expect(isWhatsAppPhoneId('233241234567')).toBe(true);
        expect(isWhatsAppPhoneId('+233241234567')).toBe(true);
        expect(isWhatsAppPhoneId(BSUID)).toBe(false);
        expect(isWhatsAppPhoneId(null)).toBe(false);
        expect(isWhatsAppPhoneId('')).toBe(false);
    });

    it('addresses a phone with `to` and a BSUID with `recipient`', () => {
        expect(whatsappDestination('233241234567')).toEqual({ to: '233241234567' });
        expect(whatsappDestination(BSUID)).toEqual({ recipient: BSUID });
    });

    it('reads the sender: phone when shared, else the BSUID; phone only from `from`', () => {
        expect(inboundSenderId({ from: '233241234567', from_user_id: BSUID })).toBe('233241234567');
        expect(inboundSenderId({ from_user_id: BSUID })).toBe(BSUID);
        expect(inboundSenderId({})).toBeNull();
        expect(inboundSenderPhone({ from_user_id: BSUID })).toBeNull();
        expect(inboundSenderPhone({ from: '233241234567', from_user_id: BSUID })).toBe('233241234567');
    });

    it('builds the Cloud API text body for either identity', () => {
        const creds = { senderId: 'ph1', accessToken: 't' } as any;
        const toPhone = buildTextRequest({ channel: 'WHATSAPP', credentials: creds, recipientId: '233241234567', text: 'hi' } as any);
        expect(toPhone.body).toMatchObject({ messaging_product: 'whatsapp', to: '233241234567', type: 'text' });
        expect(toPhone.body).not.toHaveProperty('recipient');
        const toBsuid = buildTextRequest({ channel: 'WHATSAPP', credentials: creds, recipientId: BSUID, text: 'hi' } as any);
        expect(toBsuid.body).toMatchObject({ messaging_product: 'whatsapp', recipient: BSUID, type: 'text' });
        expect(toBsuid.body).not.toHaveProperty('to');
    });
});

describe('isPhoneVerified', () => {
    it('keeps the legacy rule when phoneVerified is unset', () => {
        expect(isPhoneVerified({ channel: 'WHATSAPP', customerPhone: '+233241234567' })).toBe(true);
        expect(isPhoneVerified({ channel: 'INSTAGRAM', customerPhone: '+233241234567' })).toBe(false);
    });
    it('a typed number on a username-only WhatsApp chat is never verified', () => {
        expect(isPhoneVerified({ channel: 'WHATSAPP', customerPhone: '+233241234567', phoneVerified: false })).toBe(false);
    });
});

function ridesPrisma(conv: Record<string, unknown>) {
    const upsert = vi.fn();
    const prisma: any = {
        conversation: { findFirst: vi.fn(async () => conv), updateMany: vi.fn() },
        customer: { findFirst: vi.fn(async () => null), upsert, findUnique: vi.fn(async () => null), create: upsert },
    };
    return { prisma, upsert };
}

describe('TURBO account lookup for a username-only customer', () => {
    const conv = { customerId: null, customerPhone: '+233201111111', channel: 'WHATSAPP', externalId: BSUID };

    it('never opens or finds an account by a number the customer typed', async () => {
        const { prisma, upsert } = ridesPrisma(conv);
        const customer = await resolveConversationCustomer(prisma, { tenantId: 't1', conversationId: 'c1', customerPhone: '+233201111111' });
        expect(customer).toBeNull();
        expect(upsert).not.toHaveBeenCalled();
    });

    it('turbo.balance reports needs_phone instead of failing', async () => {
        const { prisma } = ridesPrisma(conv);
        const actions = createRideFlowActions(prisma) as any;
        const res = await actions['turbo.balance']({ tenantId: 't1', conversationId: 'c1', customerPhone: null, vars: {} });
        expect(res).toMatchObject({ ok: true, vars: { needs_phone: 'yes', member: 'no', open_ride: 'no' } });
    });

    it('a phone-keyed conversation with no phone at all still fails as before', async () => {
        const { prisma } = ridesPrisma({ customerId: null, customerPhone: null, channel: 'WHATSAPP', externalId: '233241234567' });
        const actions = createRideFlowActions(prisma) as any;
        const res = await actions['turbo.balance']({ tenantId: 't1', conversationId: 'c1', customerPhone: null, vars: {} });
        expect(res).toEqual({ ok: false });
    });
});
