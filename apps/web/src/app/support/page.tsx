import Link from 'next/link';
import { Mail, MessageCircle } from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import { ButtonLink, PageHero, Section } from '@/components/marketing/primitives';
import { FaqList } from '@/components/marketing/sections';
import type { QA } from '@/components/marketing/content';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import { LEGAL_EMAIL, SUPPORT_EMAIL, supportWhatsAppUrl } from '@/lib/site';

const CRUMBS = [{ name: 'Support', path: '/support' }];

export const metadata = pageMetadata({
    title: 'Bookly support: get help from a person',
    description:
        'How to reach the Bookly team, plus quick answers about bookings, reminders, deposits, passwords and your account.',
    path: '/support',
});

const HELP: readonly QA[] = [
    {
        q: 'A customer says they booked but I cannot see it',
        a: 'Open Bookings and choose "All" at the top. Bookings waiting for a deposit show as "Awaiting payment" and are let go after 30 minutes if the deposit is not paid.',
    },
    {
        q: 'Bookly stopped replying to a customer',
        a: "Open the chat. If it says a person took over, tap \"Resume assistant\". If your plan's monthly messages are used up, the assistant pauses until next month or an upgrade.",
    },
    {
        q: 'Customers are not getting reminders',
        a: 'Reminders need a WhatsApp-approved message template. Go to Settings, then Message templates, and add one for reminders and one for confirmations. We can do this with you.',
    },
    {
        q: 'How do deposits work?',
        a: 'Go to Settings, then Deposits. When it is on, Bookly sends a payment link and holds the time for 30 minutes. The booking is confirmed once the deposit is paid. You need payments connected under Settings, then Payments.',
    },
    {
        q: 'I forgot my password',
        a: 'On the log in page choose "Forgot your password?" and we will email you a link that works for one hour.',
    },
    {
        q: 'How do I delete my account?',
        a: 'Go to Settings, then Delete account. We confirm the request within 7 days and remove your business, chats and bookings.',
    },
];

export default function SupportPage() {
    const whatsapp = supportWhatsAppUrl('Hi Bookly, I need some help');
    const email = SUPPORT_EMAIL || LEGAL_EMAIL;

    return (
        <SiteShell current="/support" jsonLd={[breadcrumbJsonLd(CRUMBS)]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="Support"
                title="How can we help?"
                sub="A person replies during business hours, Ghana time. Most questions are answered the same day."
            >
                {whatsapp && (
                    <ButtonLink href={whatsapp} variant="primary">
                        <MessageCircle className="h-5 w-5" aria-hidden /> Message us on WhatsApp
                    </ButtonLink>
                )}
                <ButtonLink href={`mailto:${email}?subject=${encodeURIComponent('Bookly support')}`} variant={whatsapp ? 'secondary' : 'primary'}>
                    <Mail className="h-5 w-5" aria-hidden /> Email us<span className="sr-only"> at {email}</span>
                </ButtonLink>
            </PageHero>

            <Section labelledBy="common">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
                    <div>
                        <h2 id="common" className="text-[1.5rem] font-bold text-text sm:text-[1.75rem]">Common questions</h2>
                        <p className="mt-2 text-body text-muted">Quick fixes for the things we hear most.</p>
                    </div>
                    <FaqList items={HELP} />
                </div>
            </Section>

            <Section tone="soft" className="!py-10">
                <p className="text-body text-muted">
                    Thinking about Bookly? Read the <Link href="/faq" className="font-semibold text-primary underline underline-offset-4">questions page</Link> or{' '}
                    <Link href="/about#contact" className="font-semibold text-primary underline underline-offset-4">ask for a demo</Link>. See also our{' '}
                    <Link href="/privacy" className="font-semibold text-primary underline underline-offset-4">privacy policy</Link> and{' '}
                    <Link href="/terms" className="font-semibold text-primary underline underline-offset-4">terms</Link>.
                </p>
            </Section>
        </SiteShell>
    );
}
