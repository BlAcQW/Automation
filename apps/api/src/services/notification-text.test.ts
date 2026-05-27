import { describe, it, expect } from 'vitest';
import { buildTextBundle } from './notification-text';

describe('buildTextBundle', () => {
    it('builds BOOKING_CONFIRMATION with 5 vars', () => {
        const bundle = buildTextBundle('BOOKING_CONFIRMATION', [
            'Jane', 'Haircut', '2026-05-20', '10:00', 'BK-ABCDEF',
        ]);
        expect(bundle).not.toBeNull();
        expect(bundle!.sms).toContain('Jane');
        expect(bundle!.sms).toContain('Haircut');
        expect(bundle!.sms).toContain('BK-ABCDEF');
        expect(bundle!.emailSubject).toContain('Haircut');
        expect(bundle!.emailHtml).toContain('Haircut');
    });

    it('returns null when BOOKING_CONFIRMATION var count is wrong', () => {
        expect(buildTextBundle('BOOKING_CONFIRMATION', ['only', 'three', 'vars'])).toBeNull();
    });

    it('builds BOOKING_REMINDER with 2 vars', () => {
        const b = buildTextBundle('BOOKING_REMINDER', ['Haircut', '10:00']);
        expect(b?.sms).toContain('Haircut');
        expect(b?.sms).toContain('10:00');
    });

    it('builds BOOKING_CANCELLED with 2 vars', () => {
        const b = buildTextBundle('BOOKING_CANCELLED', ['Haircut', '2026-05-20']);
        expect(b?.sms).toContain('cancelled');
    });

    it('builds BOOKING_RESCHEDULED with 3 vars', () => {
        const b = buildTextBundle('BOOKING_RESCHEDULED', ['Haircut', '2026-05-25', '14:00']);
        expect(b?.sms).toContain('rescheduled');
        expect(b?.sms).toContain('14:00');
    });

    it('builds ORDER_CONFIRMATION with 2 vars', () => {
        const b = buildTextBundle('ORDER_CONFIRMATION', ['ORD-XYZ', '25.00']);
        expect(b?.sms).toContain('ORD-XYZ');
        expect(b?.sms).toContain('25.00');
    });

    it('builds ORDER_SHIPPED with 1 var', () => {
        const b = buildTextBundle('ORDER_SHIPPED', ['ORD-XYZ']);
        expect(b?.sms).toContain('shipped');
    });

    it('builds ORDER_DELIVERED with 1 var', () => {
        const b = buildTextBundle('ORDER_DELIVERED', ['ORD-XYZ']);
        expect(b?.sms).toContain('delivered');
    });

    it('escapes HTML in user-supplied variables', () => {
        const bundle = buildTextBundle('BOOKING_CONFIRMATION', [
            'Jane', 'Pizza <script>alert(1)</script>', '2026-05-20', '10:00', 'BK-ABC',
        ]);
        expect(bundle).not.toBeNull();
        // SMS is plain text — no HTML escaping concern there.
        expect(bundle!.sms).toContain('<script>');
        // Email HTML must have the angle brackets escaped.
        expect(bundle!.emailHtml).not.toContain('<script>');
        expect(bundle!.emailHtml).toContain('&lt;script&gt;');
    });
});
