import { describe, it, expect } from 'vitest';
import {
    BOOKLY_TAGLINE,
    EMAIL_COLORS,
    emailButton,
    emailDetails,
    emailLink,
    escapeHtml,
    renderEmailLayout,
    renderEmailText,
} from './email-layout';
import { buildTextBundle } from './notification-text';
import { passwordResetEmail } from './password-reset';
import { verificationEmail } from './email-verification';
import { inviteEmail } from './tenant-onboarding';

/** WCAG relative-luminance contrast ratio for two #RRGGBB colours. */
function contrast(a: string, b: string): number {
    const lum = (hex: string) => {
        const [r, g, bl] = [1, 3, 5].map((i) => {
            const c = parseInt(hex.slice(i, i + 2), 16) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('email-layout', () => {
    const html = renderEmailLayout({
        title: 'Hello <there>',
        preheader: 'Preview & more',
        heading: "Let's go",
        bodyHtml: '<p>Body</p>',
        footerNote: 'Because <reasons>',
    });

    it('renders a full, light-only document with the brand shell', () => {
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html).toContain('<meta name="color-scheme" content="light only">');
        expect(html).toContain(`background:${EMAIL_COLORS.cream}`);
        expect(html).toContain('border-radius:24px');
        expect(html).toContain('>Bookly</span>');
        expect(html).toContain(BOOKLY_TAGLINE);
        expect(html).toContain('<p>Body</p>');
    });

    it('draws the gold awning without images', () => {
        expect(html).toContain(`bgcolor="${EMAIL_COLORS.gold}"`);
        expect(html).not.toMatch(/<img\b/i);
    });

    it('escapes title, preheader, heading and footer note', () => {
        expect(html).toContain('<title>Hello &lt;there&gt;</title>');
        expect(html).toContain('Preview &amp; more');
        expect(html).toContain('Let&#39;s go');
        expect(html).toContain('Because &lt;reasons&gt;');
    });

    it('uses a web-safe font stack with Bricolage first', () => {
        expect(html).toMatch(/font-family:'Bricolage Grotesque', [^;"]*sans-serif/);
    });

    it('builds a bulletproof, 44px+ green button with an Outlook fallback', () => {
        const b = emailButton('Go "now"', 'https://x.test/a?b=1&c=2');
        expect(b).toContain('href="https://x.test/a?b=1&amp;c=2"');
        expect(b).toContain('v:roundrect');
        expect(b).toContain('min-height:48px');
        expect(b).toContain(`bgcolor="${EMAIL_COLORS.green}"`);
        expect(b).toContain('Go &quot;now&quot;');
    });

    it('escapes detail rows and links', () => {
        expect(emailDetails([['Service', '<b>x</b>']])).toContain('&lt;b&gt;x&lt;/b&gt;');
        expect(emailLink('<x>', 'https://a.test/"')).toContain('href="https://a.test/&quot;"');
    });

    it('adds the Bookly sign-off to plain text', () => {
        expect(renderEmailText(['Hi'])).toBe(`Hi\n\n--\nBookly · ${BOOKLY_TAGLINE}`);
    });

    it('escapeHtml covers all five special characters', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('brand text colours meet WCAG AA (4.5:1)', () => {
        const C = EMAIL_COLORS;
        expect(contrast(C.charcoal, C.white)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.charcoal, C.cream)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.muted, C.white)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.muted, C.cream)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.muted, C.soft)).toBeGreaterThanOrEqual(4.5);
        expect(contrast('#FFFFFF', C.green)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.green, C.white)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.green, C.cream)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('every email uses the Bookly shell', () => {
    const all = {
        verification: verificationEmail({ name: 'Ama', businessName: 'Glow', link: 'https://x.test/v?token=a' }),
        reset: passwordResetEmail({ name: 'Ama', link: 'https://x.test/r?token=a' }),
        invite: { ...inviteEmail({ ownerName: 'Ama', orgName: 'Glow', link: 'https://x.test/i' }) },
        booking: (() => {
            const b = buildTextBundle('BOOKING_CONFIRMATION', ['Jane', 'Haircut', '2026-05-20', '10:00', 'BK-1'])!;
            return { subject: b.emailSubject, text: b.emailText, html: b.emailHtml };
        })(),
    };

    it.each(Object.entries(all))('%s has the shell, a tagline and a text sign-off', (_name, mail) => {
        expect(mail.html).toContain('<!DOCTYPE html>');
        expect(mail.html).toContain(BOOKLY_TAGLINE);
        expect(mail.text.endsWith(`Bookly · ${BOOKLY_TAGLINE}`)).toBe(true);
    });

    it.each([
        ['verification', all.verification, 'Confirm my email', 'https://x.test/v?token=a'],
        ['reset', all.reset, 'Choose a new password', 'https://x.test/r?token=a'],
        ['invite', all.invite, 'Accept invite', 'https://x.test/i'],
    ])('%s has its button pointing at the link', (_n, mail, label, link) => {
        expect(mail.html).toContain(`href="${link}"`);
        expect(mail.html).toContain(`>${label}</a>`);
        expect(mail.text).toContain(link);
    });

    it('keeps the subjects unchanged', () => {
        expect(all.verification.subject).toBe('Confirm your email for Bookly');
        expect(all.reset.subject).toBe('Reset your Bookly password');
        expect(all.invite.subject).toBe('You have been invited to manage Glow on Bookly');
        expect(all.booking.subject).toBe('Booking confirmed: Haircut');
    });
});
