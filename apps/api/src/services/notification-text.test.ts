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

describe('buildTextBundle — customer self-service link injection', () => {
    it('appends the tracking link to an ORDER_SHIPPED SMS', () => {
        const b = buildTextBundle('ORDER_SHIPPED', ['ORD-XYZ'], {
            trackUrl: 'https://bookly.ikieguy.online/track/abc123',
        });
        expect(b!.sms).toContain('Track your order: https://bookly.ikieguy.online/track/abc123');
        expect(b!.emailText).toContain('Track your order:');
        expect(b!.emailHtml).toContain('Track your order</a>');
    });

    it('appends the cancel link to a BOOKING_REMINDER SMS', () => {
        const b = buildTextBundle('BOOKING_REMINDER', ['Haircut', '10:00'], {
            cancelUrl: 'https://bookly.ikieguy.online/c/xyz789',
        });
        expect(b!.sms).toContain('Need to cancel? https://bookly.ikieguy.online/c/xyz789');
    });

    it('leaves the SMS untouched when no links are supplied', () => {
        const b = buildTextBundle('ORDER_SHIPPED', ['ORD-XYZ']);
        expect(b!.sms).not.toContain('Track your order');
    });

    it('does not put a tracking link on a booking purpose', () => {
        const b = buildTextBundle('BOOKING_REMINDER', ['Haircut', '10:00'], {
            trackUrl: 'https://bookly.ikieguy.online/track/abc123',
        });
        expect(b!.sms).not.toContain('Track your order');
    });

    it('still returns null on a variable-count mismatch even with links', () => {
        expect(buildTextBundle('ORDER_SHIPPED', [], { trackUrl: 'x' })).toBeNull();
    });
});

describe('buildTextBundle — Bookly email rendering', () => {
    it('shows booking facts in a details block and escapes them', () => {
        const b = buildTextBundle('BOOKING_CONFIRMATION', ['Jane', 'Cut & <b>Style</b>', '2026-05-20', '10:00', 'BK-1'])!;
        expect(b.emailHtml).toContain('>Reference</td>');
        expect(b.emailHtml).toContain('Cut &amp; &lt;b&gt;Style&lt;/b&gt;');
        expect(b.emailHtml).not.toContain('<b>Style</b>');
        expect(b.emailText).toContain('Reference: BK-1');
    });

    it('puts the tracking link in a button inside the card, before the footer', () => {
        const url = 'https://bookly.ikieguy.online/track/abc123';
        const b = buildTextBundle('ORDER_CONFIRMATION', ['ORD-1', 'GH₵ 25.00'], { trackUrl: url })!;
        const btn = b.emailHtml.indexOf(`href="${url}"`);
        expect(btn).toBeGreaterThan(-1);
        expect(btn).toBeLessThan(b.emailHtml.indexOf('Your shop, always open.'));
        expect(b.emailHtml).toContain('GH₵ 25.00');
        // Link sits above the sign-off in plain text too.
        expect(b.emailText.indexOf('Track your order:')).toBeLessThan(b.emailText.indexOf('--\nBookly'));
    });

    it('offers the cancel link as a quiet text link, not a big button', () => {
        const url = 'https://bookly.ikieguy.online/c/xyz789';
        const b = buildTextBundle('BOOKING_REMINDER', ['Haircut', '10:00'], { cancelUrl: url })!;
        expect(b.emailHtml).toContain('Cancel this appointment</a>');
        expect(b.emailHtml).not.toContain('v:roundrect');
        expect(b.emailText).toContain(`Need to cancel? ${url}`);
    });

    it.each([
        ['BOOKING_CONFIRMATION', ['Jane', 'Haircut', 'd', 't', 'r']],
        ['BOOKING_REMINDER', ['Haircut', '10:00']],
        ['BOOKING_CANCELLED', ['Haircut', 'd']],
        ['BOOKING_RESCHEDULED', ['Haircut', 'd', 't']],
        ['ORDER_CONFIRMATION', ['ORD-1', '25.00']],
        ['ORDER_SHIPPED', ['ORD-1']],
        ['ORDER_DELIVERED', ['ORD-1']],
    ] as const)('%s renders the branded shell and sign-off', (purpose, vars) => {
        const b = buildTextBundle(purpose, [...vars])!;
        expect(b.emailHtml.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(b.emailHtml).toContain('Your shop, always open.');
        expect(b.emailText).toContain('Bookly · Your shop, always open.');
        expect(b.sms).not.toContain('Bookly');
    });
});
