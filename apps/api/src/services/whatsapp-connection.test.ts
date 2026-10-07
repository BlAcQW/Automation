import { describe, it, expect } from 'vitest';
import {
    buildEmbeddedSignupSetup,
    buildWhatsappStatus,
    categoryFor,
    classifyEmbeddedSignupError,
    classifyOnboardingError,
    META_BUSINESS_CATEGORIES,
    utcOffsetLabel,
    type TenantConnectionRow,
} from './whatsapp-connection.js';
import { NumberOnboardingError } from './meta-number-onboarding.js';
import { EmbeddedSignupError } from './meta-embedded-signup.js';

const row = (over: Partial<TenantConnectionRow> = {}): TenantConnectionRow => ({
    whatsappPhoneNumberId: null, whatsappDisplayNumber: null, whatsappHosted: false, whatsappNumberStatus: null,
    whatsappConnectionMode: null, whatsappConnectedAt: null, whatsappVerifiedName: null, whatsappNameStatus: null,
    whatsappCodeMethod: null, whatsappCodeSentAt: null, whatsappQualityRating: null, whatsappMessagingLimit: null,
    whatsappMetaStatus: null, whatsappHealthProblem: null, whatsappHealthCheckedAt: null, whatsappTokenExpiresAt: null,
    ...over,
});

describe('buildWhatsappStatus', () => {
    it('states: not connected, pending code, registering, connected, problem', () => {
        expect(buildWhatsappStatus(null).state).toBe('NOT_CONNECTED');
        expect(buildWhatsappStatus(row({ whatsappPhoneNumberId: 'p', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE' })))
            .toMatchObject({ state: 'PENDING_CODE', connected: false, awaitingCode: true, mode: 'BOOKLY_HOSTED', connectedAt: null });
        expect(buildWhatsappStatus(row({ whatsappPhoneNumberId: 'p', whatsappHosted: true, whatsappNumberStatus: 'VERIFIED' })).state).toBe('REGISTERING');
        const at = new Date('2026-10-01T00:00:00Z');
        expect(buildWhatsappStatus(row({ whatsappPhoneNumberId: 'p', whatsappConnectedAt: at })))
            .toMatchObject({ state: 'CONNECTED', connected: true, mode: 'OWN_ACCOUNT', connectedAt: at, billedBy: 'ORGANISATION' });
        expect(buildWhatsappStatus(row({ whatsappPhoneNumberId: 'p', whatsappHealthProblem: 'NUMBER_BANNED' })))
            .toMatchObject({ state: 'PROBLEM', connected: true, health: { problem: 'NUMBER_BANNED' } });
    });

    it('an unknown stored mode falls back by the hosted flag', () => {
        expect(buildWhatsappStatus(row({ whatsappPhoneNumberId: 'p', whatsappConnectionMode: 'WEIRD' })).mode).toBe('OWN_ACCOUNT');
        expect(buildWhatsappStatus(row({ whatsappPhoneNumberId: 'p', whatsappConnectionMode: 'MANUAL' })).mode).toBe('MANUAL');
    });
});

describe('classifyOnboardingError', () => {
    it('does not mistake "generate" for a rate limit', () => {
        expect(classifyOnboardingError(new NumberOnboardingError('register', 'http_400: could not generate certificate')).publicCode).toBe('META_ERROR');
    });
    it('config -> HOSTED_NOT_AVAILABLE (503)', () => {
        const e = classifyOnboardingError(new NumberOnboardingError('config', 'unset'));
        expect([e.statusCode, e.publicCode]).toEqual([503, 'HOSTED_NOT_AVAILABLE']);
    });
});

describe('Embedded Signup prefill', () => {
    it('category: RIDES -> TRAVEL, products -> RETAIL, services -> PROF_SERVICES, all valid Meta values', () => {
        expect(categoryFor('RIDES', 'SERVICE')).toBe('TRAVEL');
        expect(categoryFor('APPOINTMENTS', 'PRODUCT')).toBe('RETAIL');
        expect(categoryFor('APPOINTMENTS', 'SERVICE')).toBe('PROF_SERVICES');
        for (const c of ['TRAVEL', 'RETAIL', 'PROF_SERVICES']) expect(META_BUSINESS_CATEGORIES).toContain(c);
    });

    it('UTC offset label in Meta format', () => {
        expect(utcOffsetLabel('Africa/Accra')).toBe('UTC+00:00');
        expect(utcOffsetLabel('Africa/Lagos')).toBe('UTC+01:00');
        expect(utcOffsetLabel('America/Caracas')).toBe('UTC-04:00');
        expect(utcOffsetLabel('Not/AZone')).toBeNull();
    });

    it('omits what Bookly does not know', () => {
        expect(buildEmbeddedSignupSetup({ name: '  Kim Salon ', vertical: 'APPOINTMENTS', businessType: 'SERVICE', timezone: 'Bad/Zone', paymentCurrency: 'USD' }, null))
            .toEqual({ business: { name: 'Kim Salon' }, phone: { displayName: 'Kim Salon', category: 'PROF_SERVICES', description: '' } });
    });
});

describe('classifyEmbeddedSignupError', () => {
    it('a two-step PIN Bookly cannot reset is TWO_STEP_PIN_LOCKED, telling the owner how to turn it off', () => {
        const e = classifyEmbeddedSignupError(new EmbeddedSignupError('set_two_step_pin', 'http_403: {"error":{"code":10}}'));
        expect(e.publicCode).toBe('TWO_STEP_PIN_LOCKED');
        expect(e.statusCode).toBe(409);
        expect(e.message).toMatch(/WhatsApp Manager/);
        expect(e.message).toMatch(/Two-step verification/);
    });

    it('other register failures stay META_ERROR', () => {
        const e = classifyEmbeddedSignupError(new EmbeddedSignupError('register_number', 'http_400: {"error":{"code":133010}}'));
        expect(e.publicCode).toBe('META_ERROR');
    });
});
