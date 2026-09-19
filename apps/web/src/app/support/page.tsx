import type { Metadata } from 'next';
import Link from 'next/link';
import { SupportLinks } from '@/components/support-links';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';
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
        <main className="min-h-screen bg-ink-950 text-ink-50">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                <Link href="/" className="inline-block">
                    <BooklyWordmark size="lg" />
                </Link>

                <h1 className="mt-10 font-display text-display-md text-ink-50">Support</h1>
                <p className="mt-3 text-body-lg text-ink-300 max-w-[48ch]">
                    A person replies during business hours, Ghana time. Most questions are answered the same day.
                </p>

                <div className="mt-6">
                    {hasSupportContact ? (
                        <SupportLinks />
                    ) : (
                        <p className="text-body-sm text-ink-300">
                            Contact details are being set up. In the meantime, reply to any email you received from Bookly.
                        </p>
                    )}
                </div>

                <h2 className="mt-14 font-display text-h2 text-ink-50">Common questions</h2>
                <dl className="mt-6 divide-y divide-ink-700/70 border-y border-ink-700/70">
                    {FAQ.map((item) => (
                        <div key={item.q} className="py-5">
                            <dt className="text-body font-semibold text-ink-50">{item.q}</dt>
                            <dd className="mt-1.5 text-body-sm text-ink-300 leading-relaxed max-w-[64ch]">{item.a}</dd>
                        </div>
                    ))}
                </dl>

                <p className="mt-10 text-body-sm text-ink-300">
                    <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-50">Privacy</Link>
                    {' · '}
                    <Link href="/terms" className="underline underline-offset-2 hover:text-ink-50">Terms</Link>
                </p>
            </div>
        </main>
    );
}
