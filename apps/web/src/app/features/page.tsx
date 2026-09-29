import { Nav, Footer, MobileCTA } from '@/components/marketing/bronze/chrome';
import {
    PageHero, Section, Eyebrow, Heading, JobsGrid, ChannelCards,
    NoSetupBlock, ClosingCTA,
} from '@/components/marketing/bronze/pieces';
import { Reveal } from '@/components/marketing/bronze/motion';

export const metadata = {
    title: 'What Bookly does',
    description:
        'Answers customers while you work, books real free times, takes deposits, sends reminders, and keeps your customer list yours.',
};

export default function FeaturesPage() {
    const steps = [
        { n: '1', t: 'Connect your WhatsApp', d: 'One guided step. No code, no keys.' },
        { n: '2', t: 'Add your services and hours', d: 'What you do, what it costs, when you are open.' },
        { n: '3', t: 'Share your number', d: 'Put it in your Instagram bio. The assistant takes it from there.' },
    ];
    const fits = [
        'Salons, barbers, nail and lash techs', 'Spas, dental and aesthetic clinics',
        'Physios, tutors and trainers', 'Photographers and mechanics',
        'Anyone selling on Instagram', 'Anyone with staff on the books',
    ];

    return (
        <main id="main" className="theme-bronze min-h-screen">
            <Nav />
            <PageHero
                eyebrow="What it does"
                title="A receptionist who never takes lunch."
                sub="Seven jobs, in the order you'll feel them."
            />

            <Section><JobsGrid /></Section>

            <Section tint><NoSetupBlock /></Section>

            <Section>
                <Eyebrow>Where it works</Eyebrow>
                <Heading sub="One assistant and one diary behind every channel.">
                    Three inboxes, one place.
                </Heading>
                <div className="mt-10"><ChannelCards /></div>
            </Section>

            <Section tint>
                <Eyebrow>Getting started</Eyebrow>
                <Heading sub="Most people are taking bookings the same afternoon.">Three steps, once.</Heading>
                <Reveal className="mt-10 grid gap-8 sm:grid-cols-3">
                    {steps.map((s) => (
                        <div key={s.n}>
                            <span className="font-display text-4xl" style={{ color: 'var(--primary)' }}>{s.n}</span>
                            <h3 className="mt-3 font-semibold" style={{ color: 'var(--foreground)' }}>{s.t}</h3>
                            <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{s.d}</p>
                        </div>
                    ))}
                </Reveal>
            </Section>

            <Section>
                <Eyebrow>Who it&apos;s for</Eyebrow>
                <Heading sub="Anything booked by appointment, run by one to eight people — big enough to lose bookings while you're busy, too small to pay someone to answer the phone.">
                    Built for a business run from a phone.
                </Heading>
                <div className="mt-8 flex flex-wrap gap-2.5">
                    {fits.map((f) => (
                        <span
                            key={f}
                            className="rounded-full px-4 py-2 text-sm"
                            style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                        >
                            {f}
                        </span>
                    ))}
                </div>
            </Section>

            <ClosingCTA title="Try it on your own number." sub="Free to start. Nothing to set up first." />
            <Footer />
            <MobileCTA />
        </main>
    );
}
