import { describe, it, expect } from 'vitest';
import { waitlistConfirmationEmail, waitlistInviteEmail } from './waitlist-emails.js';

describe('waitlistConfirmationEmail', () => {
    const mail = waitlistConfirmationEmail({ name: 'Ama Mensah', businessName: 'Glow <Skin> & Co' });

    it("says they're on the Bookly waitlist, by first name", () => {
        expect(mail.subject).toBe("You're on the Bookly waitlist");
        expect(mail.text).toMatch(/^Hi Ama,/);
        expect(mail.text).toContain('Glow <Skin> & Co');
        expect(mail.text).toMatch(/WhatsApp or email/);
    });

    it('uses the branded layout and escapes the business name in HTML', () => {
        expect(mail.html).toContain('<!DOCTYPE html>');
        expect(mail.html).toContain('Your shop, always open.');
        expect(mail.html).toContain('Glow &lt;Skin&gt; &amp; Co');
        expect(mail.html).not.toContain('Glow <Skin>');
    });

    it('ends the plain-text twin with the Bookly sign-off', () => {
        expect(mail.text).toMatch(/Bookly · Your shop, always open\.$/);
    });
});

describe('waitlistInviteEmail', () => {
    const link = 'https://bookly.example/register?invite=tok_123';
    const mail = waitlistInviteEmail({
        name: 'Kofi Boateng', businessName: 'Kofi Cuts', email: 'kofi@cuts.gh', link,
        expiresAt: new Date('2026-11-12T10:00:00Z'),
    });

    it("says they're invited, with a button and the plain link", () => {
        expect(mail.subject).toBe("You're invited to Bookly");
        expect(mail.html).toContain('Create my account');
        expect(mail.html).toContain('https://bookly.example/register?invite=tok_123');
        expect(mail.text).toContain(link);
        expect(mail.text).toMatch(/^Hi Kofi,/);
    });

    it('explains the link is single-use, lasts 14 days and is for their address', () => {
        expect(mail.text).toMatch(/14 days/);
        expect(mail.text).toMatch(/once/);
        expect(mail.text).toContain('kofi@cuts.gh');
    });
});
