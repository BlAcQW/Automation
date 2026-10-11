import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendRideSms = vi.fn();
vi.mock('./notify.js', async (orig) => ({ ...(await orig<typeof import('./notify.js')>()), sendRideSms: (...a: unknown[]) => sendRideSms(...a) }));
const upsertCustomerByPhone = vi.fn();
const linkConversationToCustomer = vi.fn();
vi.mock('../customers.js', async (orig) => ({
    ...(await orig<typeof import('../customers.js')>()),
    upsertCustomerByPhone: (...a: unknown[]) => upsertCustomerByPhone(...a),
    linkConversationToCustomer: (...a: unknown[]) => linkConversationToCustomer(...a),
}));

import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MAX_CODE_SENDS, checkCode, issueCode } from './phone-verify.js';
import { createRideFlowActions } from './flow-actions.js';

const SECRET = 'test-secret-test-secret-test-secret';
const BSUID = 'GH.1234567890123456';
const base = { secret: SECRET, conversationId: 'c1', phone: '+233241234567' };

describe('phone code', () => {
    it('accepts the right code (spaces ignored) and rejects a wrong one', () => {
        const issued = issueCode({ ...base, now: 1000 });
        expect(issued.code).toMatch(/^\d{6}$/);
        const pending = { codeHash: issued.codeHash, expiresAt: issued.expiresAt };
        expect(checkCode({ ...base, input: issued.code.replace(/(\d{3})/, '$1 '), pending, now: 2000 })).toBe('ok');
        const wrong = issued.code === '000000' ? '111111' : '000000';
        expect(checkCode({ ...base, input: wrong, pending, now: 2000 })).toBe('wrong');
        expect(checkCode({ ...base, input: '12', pending, now: 2000 })).toBe('wrong');
    });

    it('expires', () => {
        const issued = issueCode({ ...base, now: 0 });
        expect(checkCode({ ...base, input: issued.code, pending: issued, now: CODE_TTL_MS + 1 })).toBe('expired');
    });

    it('is bound to the conversation and the number', () => {
        const issued = issueCode({ ...base, now: 0 });
        expect(checkCode({ ...base, conversationId: 'c2', input: issued.code, pending: issued, now: 1 })).toBe('wrong');
        expect(checkCode({ ...base, phone: '+233201111111', input: issued.code, pending: issued, now: 1 })).toBe('wrong');
    });

    it('a forged or missing hash never passes', () => {
        const issued = issueCode({ ...base, now: 0 });
        expect(checkCode({ ...base, input: issued.code, pending: { codeHash: 'ab'.repeat(32), expiresAt: issued.expiresAt }, now: 1 })).toBe('wrong');
        expect(checkCode({ ...base, input: issued.code, pending: {}, now: 1 })).toBe('invalid');
        expect(checkCode({ ...base, secret: 'other-secret-other-secret-other-secret', input: issued.code, pending: issued, now: 1 })).toBe('wrong');
    });
});

function fakePrisma(externalId: string) {
    return {
        conversation: {
            findFirst: vi.fn(async () => ({ channel: 'WHATSAPP', externalId, customerId: null, customerPhone: null })),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
    } as any;
}
const req = (vars: Record<string, string | number>) => ({ tenantId: 't1', conversationId: 'c1', customerPhone: null, name: 'x', args: {}, vars, idempotencyKey: 'k' }) as any;

beforeEach(() => {
    sendRideSms.mockReset().mockResolvedValue(true);
    upsertCustomerByPhone.mockReset().mockResolvedValue({ id: 'cust-9' });
    linkConversationToCustomer.mockReset().mockResolvedValue(true);
});

describe('turbo.send_phone_code / turbo.verify_phone_code', () => {
    it('texts a code to the given number and links the account only after the right code', async () => {
        const prisma = fakePrisma(BSUID);
        const actions = createRideFlowActions(prisma) as any;

        const sent = await actions['turbo.send_phone_code'](req({ verify_phone: '+233241234567' }));
        expect(sent.vars).toMatchObject({ code_sent: 'yes', code_attempts: 0, code_sends: 1 });
        expect(sendRideSms).toHaveBeenCalledTimes(1);
        expect(sendRideSms.mock.calls[0][1]).toMatchObject({ tenantId: 't1', phone: '+233241234567' });
        const code = String(sendRideSms.mock.calls[0][1].text).match(/\d{6}/)![0];
        expect(JSON.stringify(sent.vars)).not.toContain(code); // only the hash is kept

        const pending = { verify_phone: '+233241234567', code_hash: sent.vars.code_hash, code_expires: sent.vars.code_expires, code_attempts: 0 };
        const wrong = await actions['turbo.verify_phone_code'](req({ ...pending, verify_code: code === '000000' ? '111111' : '000000' }));
        expect(wrong.vars).toMatchObject({ phone_ok: 'retry', code_attempts: 1 });
        expect(upsertCustomerByPhone).not.toHaveBeenCalled();

        const ok = await actions['turbo.verify_phone_code'](req({ ...pending, verify_code: code }));
        expect(ok.vars).toMatchObject({ phone_ok: 'yes' });
        expect(upsertCustomerByPhone).toHaveBeenCalledWith(prisma, { tenantId: 't1', phone: '+233241234567' });
        expect(linkConversationToCustomer).toHaveBeenCalledWith(prisma, { tenantId: 't1', conversationId: 'c1', customerId: 'cust-9' });
        expect(prisma.conversation.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1' }, data: { customerPhone: '+233241234567' } });
    });

    it('too many wrong codes makes the customer start again', async () => {
        const actions = createRideFlowActions(fakePrisma(BSUID)) as any;
        const sent = await actions['turbo.send_phone_code'](req({ verify_phone: '+233241234567' }));
        const r = await actions['turbo.verify_phone_code'](req({
            verify_phone: '+233241234567', code_hash: sent.vars.code_hash, code_expires: sent.vars.code_expires,
            code_attempts: MAX_CODE_ATTEMPTS - 1, verify_code: 'abcdef',
        }));
        expect(r.vars.phone_ok).toBe('restart');
    });

    it('caps the codes sent per session', async () => {
        const actions = createRideFlowActions(fakePrisma(BSUID)) as any;
        const r = await actions['turbo.send_phone_code'](req({ verify_phone: '+233241234567', code_sends: MAX_CODE_SENDS }));
        expect(r.vars.code_sent).toBe('no');
        expect(sendRideSms).not.toHaveBeenCalled();
    });

    it('reports a failed SMS so the flow can hand over', async () => {
        sendRideSms.mockResolvedValue(false);
        const actions = createRideFlowActions(fakePrisma(BSUID)) as any;
        const r = await actions['turbo.send_phone_code'](req({ verify_phone: '+233241234567' }));
        expect(r.vars.code_sent).toBe('no');
    });

    it('is refused on a phone-keyed chat (the number is already verified by Meta)', async () => {
        const actions = createRideFlowActions(fakePrisma('233241234567')) as any;
        const r = await actions['turbo.send_phone_code'](req({ verify_phone: '+233201111111' }));
        expect(r.vars.code_sent).toBe('no');
        expect(sendRideSms).not.toHaveBeenCalled();
    });
});
