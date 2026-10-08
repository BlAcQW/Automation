import type { Metadata } from 'next';
import Link from 'next/link';
import { SupportLinks } from '@/components/support-links';
import { Nav, Footer } from '@/components/marketing/site/chrome';
import { PageHero, Section, Eyebrow, Heading } from '@/components/marketing/site/pieces';
import { hasSupportContact } from '@/lib/site';

export const metadata: Metadata = {
    title: 'Support',
    description: 'How to reach the Bookly team, and answers to the questions we get most.',
};

const FAQ = [
    {
        q: 'A customer says they booked but I cannot see it',
        a: 'Open Bookings and choose "All" at the top. Bookings waiting for a deposit show as "Awaiting payment" and are released after 30 minutes if the deposit is not paid.',
    },
    {
        q: 'The assistant stopped replying to a customer',
        a: 'Open the chat. If it says a person took over, tap "Resume assistant". If your plan\'s monthly messages are used up, the assistant pauses until the next month or an upgrade.',
    },
    {
        q: 'Customers are not getting reminders',
        a: 'Reminders need a WhatsApp-approved message template. Go to Settings → Message templates and add one for reminders and one for confirmations. We can do this with you.',
    },
    {
        q: 'How do deposits work?',
        a: 'Settings → Deposits. When on, the assistant sends a payment link and holds the time for 30 minutes. The booking is confirmed once the deposit is paid. You need Paystack connected under Settings → Payments.',
    },
    {
        q: 'I forgot my password',
        a: 'On the sign-in page choose "Forgot your password?" and we will email you a link that works for one hour.',
    },
    {
        q: 'How do I delete my account?',
        a: 'Settings → Delete account. We confirm the request within 7 days and remove your business, chats and bookings.',
    },
];

export default function SupportPage() {
    return (
        <main id="main" className="theme-site">
            <Nav />
            <PageHero
                eyebrow="Support"
                title="Support"
                sub="A person replies during business hours, Ghana time. Most questions are answered the same day."
            />

            <Section>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-end">
                    <div>
                        <Eyebrow>Talk to a person</Eyebrow>
                        <Heading>Reach the Bookly team.</Heading>
                    </div>
                    <div>
                        {hasSupportContact ? (
                            <SupportLinks />
                        ) : (
                            <p className="max-w-[48ch] text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                                Contact details are being set up. In the meantime, reply to any email you received from Bookly.
                            </p>
                        )}
                    </div>
                </div>
            </Section>

            <Section tint>
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
                    <h2
                        className="text-[2rem] font-normal leading-none tracking-[-0.045em] sm:text-[2.4rem]"
                        style={{ color: 'var(--foreground)' }}
                    >
                        Common questions
                    </h2>
                    <div>
                        <dl className="border-t" style={{ borderColor: 'var(--border)' }}>
                            {FAQ.map((item) => (
                                <div key={item.q} className="border-b py-5" style={{ borderColor: 'var(--border)' }}>
                                    <dt className="text-[16px] font-medium tracking-[-0.015em]" style={{ color: 'var(--foreground)' }}>{item.q}</dt>
                                    <dd className="mt-1.5 max-w-[64ch] text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{item.a}</dd>
                                </div>
                            ))}
                        </dl>

                        <p className="mt-8 text-[14px]" style={{ color: 'var(--muted-foreground)' }}>
                            <Link href="/privacy" className="underline underline-offset-2 hover:text-[color:var(--foreground)]">Privacy</Link>
                            {' · '}
                            <Link href="/terms" className="underline underline-offset-2 hover:text-[color:var(--foreground)]">Terms</Link>
                        </p>
                    </div>
                </div>
            </Section>

            <Footer />
        </main>
    );
}
