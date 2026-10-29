/**
 * Waitlist emails, in the branded layout (email-layout.ts): the confirmation
 * after joining and the invite an admin sends. Both have a plain-text twin.
 */
import { emailButton, emailDetails, emailLink, emailParagraph, escapeHtml, renderEmailLayout, renderEmailText } from './email-layout.js';
import { INVITE_TTL_DAYS } from './waitlist.js';

export interface WaitlistMail {
    subject: string;
    text: string;
    html: string;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

export function waitlistConfirmationEmail(args: { name: string; businessName: string }): WaitlistMail {
    const first = firstName(args.name);
    const subject = "You're on the Bookly waitlist";
    const text = renderEmailText([
        `Hi ${first},`,
        '',
        `Thanks for joining the Bookly waitlist for ${args.businessName}. You're on the list.`,
        '',
        "We're letting businesses in a few at a time. When it's your turn, we'll message you on WhatsApp or email with a link to set up your account.",
        '',
        "There's nothing else to do for now.",
    ]);
    const html = renderEmailLayout({
        title: subject,
        preheader: `${args.businessName} is on the list. We'll message you when it's your turn.`,
        heading: "You're on the list",
        bodyHtml: [
            emailParagraph(`Hi ${escapeHtml(first)},`),
            emailParagraph(`Thanks for joining the Bookly waitlist for <strong>${escapeHtml(args.businessName)}</strong>.`),
            emailParagraph(
                "We're letting businesses in a few at a time. When it's your turn, we'll message you on WhatsApp or email with a link to set up your account.",
            ),
            emailParagraph("There's nothing else to do for now.", { muted: true }),
        ].join('\n'),
        footerNote: "You got this email because someone joined the Bookly waitlist with this address. Not you? You can ignore it.",
    });
    return { subject, text, html };
}

export function waitlistInviteEmail(args: {
    name: string;
    businessName: string;
    email: string;
    link: string;
    expiresAt: Date;
}): WaitlistMail {
    const first = firstName(args.name);
    const subject = "You're invited to Bookly";
    const until = args.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Accra' });
    const text = renderEmailText([
        `Hi ${first},`,
        '',
        `It's your turn. Create your Bookly account for ${args.businessName} with this link:`,
        '',
        args.link,
        '',
        `The link works for ${INVITE_TTL_DAYS} days (until ${until}) and only once. Sign up with ${args.email}, the address this invite was sent to.`,
    ]);
    const html = renderEmailLayout({
        title: subject,
        preheader: `It's your turn. Set up Bookly for ${args.businessName}.`,
        heading: "You're invited",
        bodyHtml: [
            emailParagraph(`Hi ${escapeHtml(first)},`),
            emailParagraph(`It's your turn. Create your Bookly account for <strong>${escapeHtml(args.businessName)}</strong> and start taking bookings on WhatsApp.`),
            emailButton('Create my account', args.link),
            emailDetails([
                ['Sign up with', args.email],
                ['Link works until', until],
            ]),
            emailParagraph(
                `The link works for ${INVITE_TTL_DAYS} days and only once. If the button does not open, copy this address into your browser:<br>${emailLink(args.link, args.link)}`,
                { small: true, muted: true },
            ),
        ].join('\n'),
        footerNote: 'You got this email because you joined the Bookly waitlist.',
    });
    return { subject, text, html };
}
