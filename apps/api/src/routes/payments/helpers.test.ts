import { describe, expect, it } from 'vitest';
import {
    validatePaystackKeysForEnv,
    buildUnattributedChargeReport,
    MAX_LOGGED_REFERENCE_LENGTH,
} from './index.js';

describe('validatePaystackKeysForEnv', () => {
    it('rejects sk_test_ keys in production with a clear message', () => {
        const r = validatePaystackKeysForEnv('sk_test_abc123', 'pk_live_abc', 'production');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toMatch(/test/i);
    });

    it('accepts a live key pair in production and returns them trimmed', () => {
        expect(validatePaystackKeysForEnv('  sk_live_abc123\n', ' pk_live_xyz ', 'production')).toEqual({
            ok: true,
            secretKey: 'sk_live_abc123',
            publicKey: 'pk_live_xyz',
        });
    });

    it('requires sk_live_ in production rather than only blocking sk_test_', () => {
        // Restricted test keys, malformed strings and wrong-case prefixes must
        // not slip through a denylist.
        for (const key of ['rk_test_abc', 'SK_TEST_abc', 'Sk_Test_abc', 'garbage', 'sk_live_', 'sk_live_ab cd']) {
            expect(validatePaystackKeysForEnv(key, 'pk_live_x', 'production').ok).toBe(false);
        }
    });

    it('requires a live public key in production', () => {
        const r = validatePaystackKeysForEnv('sk_live_abc', 'pk_test_abc', 'production');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toMatch(/public/i);
    });

    it('accepts test keys outside production, still trimmed', () => {
        expect(validatePaystackKeysForEnv(' sk_test_abc ', 'pk_test_abc', 'development')).toEqual({
            ok: true,
            secretKey: 'sk_test_abc',
            publicKey: 'pk_test_abc',
        });
        expect(validatePaystackKeysForEnv('sk_test_abc', 'pk_test_abc', 'test').ok).toBe(true);
    });

    it('does not reject a live key whose random part happens to contain "test"', () => {
        expect(validatePaystackKeysForEnv('sk_live_a1test9f', 'pk_live_x', 'production').ok).toBe(true);
    });
});

describe('buildUnattributedChargeReport', () => {
    it('captures reference, tenant, amount and currency', () => {
        const r = buildUnattributedChargeReport('no_entity_metadata', {
            reference: 'ref_1',
            tenantId: 't1',
            amount: 5000,
            currency: 'GHS',
        });
        expect(r.log).toMatchObject({ reference: 'ref_1', tenantId: 't1', amountMinor: 5000, currency: 'GHS', reason: 'no_entity_metadata' });
        expect(r.auditAction).toBe('payment.unattributed');
        expect(r.metadata).toMatchObject({ reference: 'ref_1', amountMinor: 5000, currency: 'GHS', reason: 'no_entity_metadata' });
    });

    it('records null for a missing or non-numeric amount instead of throwing', () => {
        const r = buildUnattributedChargeReport('order_not_found', { reference: 'r', tenantId: 't' });
        expect(r.log.amountMinor).toBeNull();
        expect(r.log.currency).toBeNull();
        expect(buildUnattributedChargeReport('x', { reference: 'r', tenantId: 't', amount: 'abc' as any }).log.amountMinor).toBeNull();
    });

    it('truncates an oversized reference so a signed webhook cannot bloat the audit log', () => {
        // A tenant with their own key can sign any reference it likes.
        const r = buildUnattributedChargeReport('no_entity_metadata', { reference: 'x'.repeat(10_000), tenantId: 't' });
        expect(r.log.reference.length).toBe(MAX_LOGGED_REFERENCE_LENGTH);
        expect(r.metadata.reference.length).toBe(MAX_LOGGED_REFERENCE_LENGTH);
        expect(r.targetId.length).toBe(MAX_LOGGED_REFERENCE_LENGTH);
    });

    it('also bounds a long currency string', () => {
        const r = buildUnattributedChargeReport('x', { reference: 'r', tenantId: 't', currency: 'Q'.repeat(500) });
        expect((r.log.currency ?? '').length).toBeLessThanOrEqual(8);
    });
});
