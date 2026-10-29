import Link from 'next/link';
import { BellRing, CalendarCheck, CheckCircle2, ListChecks, MessageCircle, Wallet } from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import { ButtonLink, ClosingCTA, Panel, PageHero, Section, SectionTitle, SignupLink, CheckList } from '@/components/marketing/primitives';
import { IndustryCards, FaqList, Shopfront } from '@/components/marketing/sections';
import type { QA } from '@/components/marketing/content';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';

const CRUMBS = [
    { name: 'What it does', path: '/features' },
    { name: 'WhatsApp bookings', path: '/features/whatsapp-bookings' },
];

export const metadata = pageMetadata({
    title: 'WhatsApp booking system for Ghana | Bookly',
    description:
        'Customers book on WhatsApp, pay a Mobile Money deposit and get a reminder. Bookly runs it on the official WhatsApp Business Platform.',
    path: '/features/whatsapp-bookings',
});

const FLOW = [
    { icon: MessageCircle, title: 'A customer messages you', body: 'On the WhatsApp number they already have for you. Day or night, Bookly replies in seconds.' },
    { icon: ListChecks, title: 'They pick a service', body: 'Bookly shows what you offer and what it costs, in plain words.' },
    { icon: CalendarCheck, title: 'They choose a real free time', body: 'Only times that fit your hours, your days off and the bookings you already have.' },
    { icon: Wallet, title: 'They pay the deposit', body: 'A Mobile Money or card link. The slot is held for 30 minutes and let go if nobody pays.' },
    { icon: CheckCircle2, title: 'The booking is confirmed', body: 'They get a confirmation on WhatsApp. You see it in your diary straight away.' },
    { icon: BellRing, title: 'A reminder before the day', body: 'So the deposit turns into a customer at your door, not an empty chair.' },
] as const;

const QUESTIONS: readonly QA[] = [
    { q: 'Is this the official WhatsApp?', a: "Yes. Bookly runs on Meta's official WhatsApp Business Platform. Bookly is a verified Meta Tech Provider." },
    { q: 'Can I still reply myself?', a: 'Any time. Open the chat and type. Bookly steps back and waits until you hand the chat back.' },
    { q: 'Do I pay for WhatsApp messages?', a: "You pay Meta's own WhatsApp message rates directly. We add nothing on top." },
    { q: 'What if a customer wants a different time?', a: 'They reschedule in the same chat, and their deposit moves with them.' },
];

export default function WhatsAppBookingsPage() {
    return (
        <SiteShell current="/features" jsonLd={[breadcrumbJsonLd(CRUMBS), faqJsonLd(QUESTIONS)]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="WhatsApp bookings"
                title="Bookings that happen in the chat."
                sub="Your customers already message you on WhatsApp. Bookly turns those messages into confirmed, paid bookings, while you get on with the work."
            >
                <SignupLink />
                <ButtonLink href="/pricing" variant="secondary">See pricing</ButtonLink>
            </PageHero>

            <Section labelledBy="flow">
                <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
                    <div>
                        <SectionTitle id="flow" eyebrow="Step by step" title="From hello to a paid booking." />
                        <ol className="mt-8 space-y-4">
                            {FLOW.map(({ icon: Icon, title, body }, i) => (
                                <li key={title}>
                                    <Panel className="flex gap-4 p-5">
                                        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary" aria-hidden>
                                            <Icon className="h-5 w-5" />
                                        </span>
                                        <div>
                                            <h3 className="text-[1.0625rem] font-bold text-text">
                                                <span className="sr-only">Step {i + 1}: </span>{title}
                                            </h3>
                                            <p className="mt-1 text-body text-muted">{body}</p>
                                        </div>
                                    </Panel>
                                </li>
                            ))}
                        </ol>
                    </div>
                    <div className="lg:sticky lg:top-24 lg:self-start">
                        <Shopfront />
                    </div>
                </div>
            </Section>

            <Section tone="soft" labelledBy="yours">
                <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                    <SectionTitle
                        id="yours"
                        eyebrow="Still your business"
                        title="You stay in charge of every chat."
                        sub="Bookly does the back-and-forth. You decide the services, the prices, the hours and when to step in."
                    />
                    <CheckList
                        items={[
                            'Take over any chat with one tap, and hand it back when you are done',
                            'Set your hours, days off and how many customers you take at once',
                            'Deposits go to your Bookly balance; send them to your MoMo any time',
                            'Staff see only the last four digits of a customer number',
                        ]}
                    />
                </div>
            </Section>

            <Section labelledBy="questions">
                <SectionTitle id="questions" eyebrow="Questions" title="What people ask about WhatsApp bookings." />
                <div className="mt-8 max-w-3xl"><FaqList items={QUESTIONS} /></div>
                <p className="mt-6 text-body text-muted">
                    More answers on the <Link href="/faq" className="font-semibold text-primary underline underline-offset-4">questions page</Link>.
                </p>
            </Section>

            <Section tone="surface" labelledBy="made-for">
                <SectionTitle id="made-for" eyebrow="Made for" title="Made for businesses where every booking counts." />
                <div className="mt-10"><IndustryCards /></div>
            </Section>

            <ClosingCTA title="Take your next booking on WhatsApp." sub="Free to start. Most people are taking bookings the same afternoon." />
        </SiteShell>
    );
}
