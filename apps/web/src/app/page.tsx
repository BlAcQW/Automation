import { Nav, Footer, MobileCTA } from '@/components/marketing/bronze/chrome';
import { HomeHero } from '@/components/marketing/bronze/home-hero';
import {
    Section, Eyebrow, Heading, ChannelCards, NoSetupBlock, ClosingCTA, CTA,
    TrustStrip, Comparison, WorksWith,
} from '@/components/marketing/bronze/pieces';
import { Reveal, LiftCard } from '@/components/marketing/bronze/motion';

export const metadata = {
    title: 'Bookly — never lose a booking because you were busy',
    description:
        'A receptionist for your WhatsApp and Instagram. Answers customers while you work, books real free times, and takes a deposit so they show up.',
};

/**
 * Home. Deliberately short: the problem, the proof, what makes it different,
 * one way forward. Everything else lives on its own page so a phone reader
 * is never scrolling through a whole site to find one answer.
 */
export default function HomePage() {
    return (
        <main id="main" className="theme-bronze min-h-screen">
            <Nav />
            <HomeHero />
            <TrustStrip />

            <Section tint>
                <Eyebrow>What it actually costs you</Eyebrow>
                <Heading sub="Not admin. Two specific leaks, both of them money.">
                    Every missed message is a booking that went next door.
                </Heading>
                <Reveal className="mt-10 grid gap-4 sm:grid-cols-2">
                    {[
                        { n: '1', t: "You're mid-service and the phone buzzes", d: "You can't stop. By the time you reply she's booked somewhere else — and you never see the ones you lost." },
                        { n: '2', t: 'They book, then never come', d: 'Three no-shows a week at GHS 50 is GHS 600 a month gone, with the chair sat empty.' },
                    ].map((c) => (
                        <LiftCard key={c.n} className="rounded-2xl p-6" style={{ background: 'var(--background)', border: '1px solid var(--border)' }}>
                            <span
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                            >
                                {c.n}
                            </span>
                            <h3 className="mt-4 text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{c.t}</h3>
                            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{c.d}</p>
                        </LiftCard>
                    ))}
                </Reveal>
            </Section>

            <Section><NoSetupBlock /></Section>

            <Section tint>
                <Eyebrow>Why people switch</Eyebrow>
                <Heading sub="The setup is where every other tool loses people. We removed it.">
                    Nothing to sign up for first.
                </Heading>
                <div className="mt-10"><Comparison /></div>
                <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--muted-foreground)' }}>
                    Works with
                </p>
                <div className="mt-3"><WorksWith /></div>
            </Section>

            <Section>
                <Eyebrow>Where it works</Eyebrow>
                <Heading sub="Customers message you the way they already do. Nothing for them to download.">
                    Your customers don&apos;t install anything.
                </Heading>
                <div className="mt-10"><ChannelCards /></div>
                <div className="mt-8 max-w-xs"><CTA href="/features" variant="ghost">See everything it does</CTA></div>
            </Section>

            <ClosingCTA
                title="Stop losing bookings because you were busy."
                sub="Set it up this afternoon. Your assistant answers the next message that comes in."
            />
            <Footer />
            <MobileCTA />
        </main>
    );
}
