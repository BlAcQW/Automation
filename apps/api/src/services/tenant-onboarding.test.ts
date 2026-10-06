import { describe, it, expect, vi } from 'vitest';
import {
    createTenantSchema,
    createTenantWithOwner,
    inviteEmail,
    DuplicateOwnerEmailError,
} from './tenant-onboarding.js';
import { verifyResetToken, parseResetToken } from './password-reset.js';

const valid = {
    name: 'Glow Salon',
    timezone: 'Africa/Accra',
    vertical: 'APPOINTMENTS' as const,
    planId: 'starter' as const,
    owner: { name: 'Ama Mensah', email: 'ama@example.com' },
};

describe('createTenantSchema', () => {
    it('accepts a minimal valid body', () => {
        expect(createTenantSchema.safeParse(valid).success).toBe(true);
    });
    it('rejects unknown keys (strict), top level and owner', () => {
        expect(createTenantSchema.safeParse({ ...valid, isActive: false }).success).toBe(false);
        expect(createTenantSchema.safeParse({ ...valid, owner: { ...valid.owner, role: 'X' } }).success).toBe(false);
    });
    it('rejects a bogus timezone and accepts UTC', () => {
        expect(createTenantSchema.safeParse({ ...valid, timezone: 'Mars/Olympus' }).success).toBe(false);
        expect(createTenantSchema.safeParse({ ...valid, timezone: '' }).success).toBe(false);
        expect(createTenantSchema.safeParse({ ...valid, timezone: 'UTC' }).success).toBe(true);
    });
    it('rejects bad vertical, plan, quota', () => {
        expect(createTenantSchema.safeParse({ ...valid, vertical: 'TAXI' }).success).toBe(false);
        expect(createTenantSchema.safeParse({ ...valid, planId: 'gold' }).success).toBe(false);
        for (const q of [-1, 1.5, 1_000_001, '5']) {
            expect(createTenantSchema.safeParse({ ...valid, monthlyMessageQuotaOverride: q }).success).toBe(false);
        }
        for (const q of [0, 1_000_000, null]) {
            expect(createTenantSchema.safeParse({ ...valid, monthlyMessageQuotaOverride: q }).success).toBe(true);
        }
    });
    it('rejects bad owner email / short names', () => {
        expect(createTenantSchema.safeParse({ ...valid, owner: { name: 'Ama', email: 'nope' } }).success).toBe(false);
        expect(createTenantSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false);
    });
});

function fakePrisma(opts: { existing?: boolean } = {}) {
    const calls: Record<string, any[]> = { tenant: [], user: [], hours: [] };
    const tx = {
        tenant: { create: vi.fn(async (a: any) => { calls.tenant.push(a); return { id: 't1', name: a.data.name, ...a.data }; }) },
        user: { create: vi.fn(async (a: any) => { calls.user.push(a); return { id: 'u1', ...a.data }; }) },
        workingHours: { createMany: vi.fn(async (a: any) => { calls.hours.push(a); return { count: a.data.length }; }) },
    };
    const prisma: any = {
        user: { findFirst: vi.fn(async () => (opts.existing ? { id: 'x' } : null)) },
        $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    return { prisma, tx, calls };
}

const baseDeps = (prisma: any, send?: any) => ({
    prisma,
    secret: 'secret',
    frontendUrl: 'https://app.test/',
    now: new Date('2026-01-01T00:00:00Z'),
    sendInvite: send ?? vi.fn(async () => ({ ok: true })),
    emailConfigured: send !== null,
});

describe('createTenantWithOwner', () => {
    it('creates APPOINTMENTS tenant with working hours, plan, quota cycle and an OWNER without a usable password', async () => {
        const { prisma, calls } = fakePrisma();
        const r = await createTenantWithOwner(baseDeps(prisma), { ...valid, monthlyMessageQuotaOverride: 500 });
        const t = calls.tenant[0].data;
        expect(t).toMatchObject({
            name: 'Glow Salon', timezone: 'Africa/Accra', vertical: 'APPOINTMENTS',
            planId: 'starter', businessType: 'SERVICE', monthlyMessageQuotaOverride: 500,
        });
        expect(t.quotaCycleStart).toEqual(new Date('2026-01-01T00:00:00Z'));
        expect(calls.hours[0].data).toHaveLength(5);
        const u = calls.user[0].data;
        expect(u).toMatchObject({ tenantId: 't1', role: 'OWNER', email: 'ama@example.com' });
        expect(u.passwordHash).toBeTruthy();
        expect(r.invite.sent).toBe(true);
    });

    it('RIDES: applies vertical defaults, no salon working hours, ignores businessType', async () => {
        const { prisma, calls } = fakePrisma();
        await createTenantWithOwner(baseDeps(prisma), { ...valid, vertical: 'RIDES', businessType: 'PRODUCT' });
        expect(calls.tenant[0].data.depositRequired).toBe(false);
        expect(calls.tenant[0].data.businessType).toBe('SERVICE');
        expect(calls.hours).toHaveLength(0);
    });

    it('throws DuplicateOwnerEmailError before creating anything', async () => {
        const { prisma } = fakePrisma({ existing: true });
        await expect(createTenantWithOwner(baseDeps(prisma), valid)).rejects.toBeInstanceOf(DuplicateOwnerEmailError);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps a unique-violation (race) to DuplicateOwnerEmailError', async () => {
        const { prisma } = fakePrisma();
        prisma.$transaction = vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'P2002' }); });
        await expect(createTenantWithOwner(baseDeps(prisma), valid)).rejects.toBeInstanceOf(DuplicateOwnerEmailError);
    });

    it('sends an invite whose link carries a token valid for the owner', async () => {
        const { prisma, calls } = fakePrisma();
        const send = vi.fn(async () => ({ ok: true }));
        const r = await createTenantWithOwner(baseDeps(prisma, send), valid);
        expect(send).toHaveBeenCalledTimes(1);
        const arg = (send.mock.calls[0] as any[])[0];
        expect(arg.to).toBe('ama@example.com');
        expect(arg.text).toContain('https://app.test/reset-password?token=');
        expect(r.invite).toEqual({ sent: true });
        const token = decodeURIComponent(arg.text.match(/token=(\S+)/)![1]);
        const hash = calls.user[0].data.passwordHash;
        expect(verifyResetToken(token, { id: 'u1', passwordHash: hash }, 'secret', Date.parse('2026-01-01T00:10:00Z'))).toBe(true);
        expect(parseResetToken(token)?.userId).toBe('u1');
    });

    it('returns the link when email is not configured', async () => {
        const { prisma } = fakePrisma();
        const r = await createTenantWithOwner({ ...baseDeps(prisma, null), sendInvite: vi.fn() }, valid);
        expect(r.invite.sent).toBe(false);
        expect(r.invite.link).toMatch(/^https:\/\/app\.test\/reset-password\?token=/);
        expect(r.invite.reason).toBe('email_not_configured');
    });

    it('returns the link when sending fails, and does not throw', async () => {
        const { prisma } = fakePrisma();
        const send = vi.fn(async () => ({ ok: false, error: 'gmail_send: boom' }));
        const r = await createTenantWithOwner(baseDeps(prisma, send), valid);
        expect(r.invite.sent).toBe(false);
        expect(r.invite.link).toBeTruthy();
        expect(r.invite.reason).toBe('send_failed');
    });
});

describe('inviteEmail', () => {
    it('is invite-worded and escapes the name', () => {
        const m = inviteEmail({ ownerName: '<b>Ama</b>', orgName: 'Glow & Co', link: 'https://x/y' });
        expect(m.subject).toContain('Glow & Co');
        expect(m.text).toContain('https://x/y');
        expect(m.html).not.toContain('<b>Ama');
        expect(m.html).toContain('Glow &amp; Co');
    });
});
