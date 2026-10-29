import { describe, it, expect } from 'vitest';
import {
    WAITLIST_BUSINESS_TYPES,
    INVITE_TTL_DAYS,
    buildWaitlistWhere,
    hashInviteToken,
    inviteLink,
    inviteState,
    newInviteToken,
    normaliseWaitlistPhone,
    waitlistJoinSchema,
    waitlistListQuerySchema,
} from './waitlist.js';

const valid = {
    name: 'Ama Mensah',
    businessName: 'Glow Skin Clinic',
    businessType: 'skin_clinic',
    phone: '024 412 3456',
    email: '  Ama@Glow.COM ',
    city: 'East Legon, Accra',
    heardFrom: 'Instagram',
    message: 'We do facials and peels.',
    consent: true,
};

describe('waitlistJoinSchema', () => {
    it('accepts a full form and normalises email (lower-case, trimmed) and phone (+233 E.164)', () => {
        const out = waitlistJoinSchema.parse(valid);
        expect(out.email).toBe('ama@glow.com');
        expect(out.phone).toBe('+233244123456');
        expect(out.businessType).toBe('skin_clinic');
        expect(out.name).toBe('Ama Mensah');
    });

    it('optional fields can be left out or blank (stored as undefined)', () => {
        const out = waitlistJoinSchema.parse({ ...valid, heardFrom: '', message: '   ' });
        expect(out.heardFrom).toBeUndefined();
        expect(out.message).toBeUndefined();
        const out2 = waitlistJoinSchema.parse({ ...valid, heardFrom: undefined, message: undefined });
        expect(out2.heardFrom).toBeUndefined();
    });

    it('refuses an unknown business type, a bad email, a bad phone, a missing city', () => {
        expect(waitlistJoinSchema.safeParse({ ...valid, businessType: 'casino' }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, phone: '12' }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, city: '' }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false);
    });

    it('requires the consent box (true, not just truthy)', () => {
        expect(waitlistJoinSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, consent: 'yes' }).success).toBe(false);
        const { consent: _c, ...noConsent } = valid;
        expect(waitlistJoinSchema.safeParse(noConsent).success).toBe(false);
    });

    it('caps the message at 500 characters and the other fields at their column sizes', () => {
        expect(waitlistJoinSchema.safeParse({ ...valid, message: 'x'.repeat(500) }).success).toBe(true);
        expect(waitlistJoinSchema.safeParse({ ...valid, message: 'x'.repeat(501) }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, businessName: 'x'.repeat(121) }).success).toBe(false);
        expect(waitlistJoinSchema.safeParse({ ...valid, email: `${'x'.repeat(250)}@a.co` }).success).toBe(false);
    });

    it('carries the honeypot through so the route can drop the request quietly', () => {
        expect(waitlistJoinSchema.parse({ ...valid, website: 'http://spam' }).website).toBe('http://spam');
        expect(waitlistJoinSchema.parse(valid).website).toBeUndefined();
    });

    it('knows every business type from the brief, premium ones first', () => {
        expect(WAITLIST_BUSINESS_TYPES).toEqual([
            'skin_clinic', 'spa', 'dental', 'tailoring', 'private_chef', 'photography',
            'fitness', 'car_detailing', 'salon_barber', 'boutique', 'food', 'other',
        ]);
    });
});

describe('normaliseWaitlistPhone', () => {
    it('reads Ghana numbers in every common spelling as +233', () => {
        for (const v of ['0244123456', '024 412 3456', '244123456', '+233244123456', '233244123456', '+233 24 412 3456']) {
            expect(normaliseWaitlistPhone(v), v).toBe('+233244123456');
        }
    });

    it('keeps a foreign number written with a plus as E.164', () => {
        expect(normaliseWaitlistPhone('+44 7700 900123')).toBe('+447700900123');
    });

    it('refuses what cannot be a phone number', () => {
        for (const v of ['', '12', 'abc', '+1', '0', '+12345678901234567', '02441234', '+2332441234567']) {
            expect(normaliseWaitlistPhone(v), v).toBeNull();
        }
    });
});

describe('invite tokens', () => {
    it('a new token is long, url-safe and random; only its SHA-256 hex is meant for storage', () => {
        const a = newInviteToken();
        const b = newInviteToken();
        expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(a.token).not.toBe(b.token);
        expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(a.hash).toBe(hashInviteToken(a.token));
        expect(a.hash).not.toContain(a.token);
    });

    it('builds the /register?invite= link on the site, url-encoded', () => {
        expect(inviteLink('https://bookly.example/', 'abc_DEF-1')).toBe('https://bookly.example/register?invite=abc_DEF-1');
    });

    it('is valid for 14 days', () => {
        expect(INVITE_TTL_DAYS).toBe(14);
    });
});

describe('inviteState', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const base = {
        status: 'INVITED' as const,
        inviteTokenHash: 'h',
        inviteExpiresAt: new Date('2026-11-05T12:00:00Z'),
        inviteUsedAt: null as Date | null,
    };

    it('valid while INVITED, unexpired and unused', () => {
        expect(inviteState(base, now)).toBe('valid');
    });
    it('expired once the expiry passes', () => {
        expect(inviteState({ ...base, inviteExpiresAt: new Date('2026-10-29T11:59:59Z') }, now)).toBe('expired');
    });
    it('used once consumed (whatever the status says)', () => {
        expect(inviteState({ ...base, status: 'JOINED', inviteUsedAt: new Date('2026-10-28T00:00:00Z') }, now)).toBe('used');
    });
    it('invalid when unknown, or when the entry is no longer INVITED (declined, contacted, joined by hand)', () => {
        expect(inviteState(null, now)).toBe('invalid');
        expect(inviteState({ ...base, status: 'DECLINED' }, now)).toBe('invalid');
        expect(inviteState({ ...base, status: 'CONTACTED' }, now)).toBe('invalid');
        expect(inviteState({ ...base, inviteTokenHash: null }, now)).toBe('invalid');
    });
});

describe('waitlist list query and filter', () => {
    it('defaults: page 1, 20 per page, no filters', () => {
        expect(waitlistListQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
        expect(buildWaitlistWhere(waitlistListQuerySchema.parse({}))).toEqual({});
    });

    it('filters by status and business type', () => {
        const where = buildWaitlistWhere(waitlistListQuerySchema.parse({ status: 'INVITED', businessType: 'spa' }));
        expect(where).toEqual({ AND: [{ status: 'INVITED' }, { businessType: 'spa' }] });
    });

    it('refuses an unknown status or business type and caps the page size', () => {
        expect(waitlistListQuerySchema.safeParse({ status: 'WHATEVER' }).success).toBe(false);
        expect(waitlistListQuerySchema.safeParse({ businessType: 'casino' }).success).toBe(false);
        expect(waitlistListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    });

    it('searches name, business, email and phone (case-insensitive)', () => {
        const where = buildWaitlistWhere(waitlistListQuerySchema.parse({ search: 'Glow' })) as any;
        const or = where.AND[0].OR;
        expect(or).toEqual(expect.arrayContaining([
            { name: { contains: 'Glow', mode: 'insensitive' } },
            { businessName: { contains: 'Glow', mode: 'insensitive' } },
            { email: { contains: 'glow', mode: 'insensitive' } },
        ]));
    });

    it('a typed phone number matches the stored E.164 however it was spelled', () => {
        const where = buildWaitlistWhere(waitlistListQuerySchema.parse({ search: '024 412 3456' })) as any;
        expect(where.AND[0].OR).toContainEqual({ phone: { contains: '244123456' } });
    });
});
