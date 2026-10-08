import { CalendarCheck, MessageCircle, Wallet } from 'lucide-react';
import { Nav, Footer, MobileCTA } from '@/components/marketing/site/chrome';
import { HomeHero } from '@/components/marketing/site/home-hero';
import {
    Section, Eyebrow, Heading, ChannelCards, NoSetupBlock, ClosingCTA, CTA,
    TrustStrip, Comparison, WorksWith,
} from '@/components/marketing/site/pieces';
import { Reveal, LiftCard } from '@/components/marketing/site/motion';
import { Satin } from '@/components/marketing/site/satin';

export const metadata = {
    title: 'Bookly — never lose a booking because you were busy',
    description:
        'A receptionist for your WhatsApp and Instagram. Answers customers while you work, books real free times, and takes a deposit so they show up.',
};

/**
 * Home, on the reference's arc: paper hero → night statement with three
 * product facts → satin feature band → the honest sections → closing CTA →
 * wordmark footer. The stats are things Bookly does, never customer counts:
 * there are barely any customers yet and inventing them loses the real ones.
 */
export default function HomePage() {
    return (
        <main id="main" className="theme-site">
            <Nav />
            <HomeHero />
            <TrustStrip />

            <section className="fs-night">
                <div className="fs-about">
                    <span className="fs-badge">What it costs you</span>
                    <p className="fs-statement">
                        Every missed message is a booking that went next door.{' '}
                        <span className="fs-w">Bookly answers while you&apos;re mid-service, offers only the times you&apos;re
                        really free, and holds the slot with a deposit.</span>
                    </p>
                    <dl className="fs-stats">
                        {[
                            { v: '24/7', l: 'Replies in seconds, even at 11pm' },
                            { v: '30 min', l: 'A slot is held while the customer pays' },
                            { v: '0', l: 'Payment gateways or API keys for you to set up' },
                        ].map((s) => (
                            <div key={s.l} className="fs-statnum">
                                <dt className="fs-statnum-l" style={{ marginTop: 0, order: 2 }}>{s.l}</dt>
                                <dd className="fs-statnum-v" style={{ order: 1, marginBottom: 16 }}>{s.v}</dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <div className="fs-feat">
                    <div className="fs-feat-bg"><Satin /></div>
                    <div className="fs-feat-in">
                        <span className="fs-badge">Inside the app</span>
                        <h2 className="fs-h2" style={{ color: 'var(--forest-cream)' }}>
                            Every chat, <span className="fs-mute">one diary.</span>
                        </h2>
                        <p className="fs-feat-sub">
                            The conversation, the booking and the deposit, side by side, for every channel your customers use.
                        </p>
                        <Reveal className="fs-fcards">
                            <FeatureCard
                                variant={0}
                                title="Only offers real free times"
                                body="Checks your hours, days off, existing bookings and how many customers you take at once."
                            >
                                <div className="fs-panel">
                                    <p className="fs-panel-k">Saturday · Glow Hair Studio</p>
                                    <ul className="mt-3 grid grid-cols-3 gap-1.5 text-[11px]">
                                        {['9:00', '10:30', '12:00', '1:30', '3:00', '4:30'].map((t, i) => (
                                            <li
                                                key={t}
                                                className="rounded-[4px] py-1.5 text-center tabular-nums"
                                                style={
                                                    i === 3
                                                        ? { background: 'var(--forest-brand)', color: '#FBFAF7' }
                                                        : i === 1 || i === 2
                                                            ? { background: '#ECE8E2', color: '#9A9A8D', textDecoration: 'line-through' }
                                                            : { background: '#F2EFEA', color: '#141A16' }
                                                }
                                            >
                                                {t}
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: '#5F675E' }}>
                                        <CalendarCheck className="h-3 w-3" /> 1:30 offered to Ama · box braids
                                    </p>
                                </div>
                            </FeatureCard>
                            <FeatureCard
                                variant={1}
                                title="Takes the deposit up front"
                                body="Mobile Money or card. The slot is held for 30 minutes and released if nobody pays."
                            >
                                <div className="fs-panel">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="fs-panel-k">Deposit received</p>
                                            <p className="fs-panel-v">GHS 50.00</p>
                                            <p className="fs-panel-g">MTN MoMo · Ama K.</p>
                                        </div>
                                        <span className="fs-ico" style={{ background: '#F2EFEA' }}><Wallet className="h-3 w-3" /></span>
                                    </div>
                                    <div className="mt-3 flex items-center gap-2 rounded-[5px] p-2 text-[11px]" style={{ background: '#F2EFEA' }}>
                                        <MessageCircle className="h-3.5 w-3.5" style={{ color: 'var(--wa-teal)' }} />
                                        Confirmation sent on WhatsApp
                                    </div>
                                </div>
                            </FeatureCard>
                        </Reveal>
                    </div>
                </div>
            </section>

            <Section tint>
                <Eyebrow>The two leaks</Eyebrow>
                <Heading sub="Not admin. Two specific leaks, both of them money.">
                    Where the bookings go.
                </Heading>
                <Reveal className="mt-10 grid gap-4 sm:grid-cols-2">
                    {[
                        { t: "You're mid-service and the phone buzzes", d: "You can't stop. By the time you reply she's booked somewhere else — and you never see the ones you lost." },
                        { t: 'They book, then never come', d: 'Three no-shows a week at GHS 50 is GHS 600 a month gone, with the chair sat empty.' },
                    ].map((c) => (
                        <LiftCard key={c.t} className="rounded-[6px] p-6" style={{ background: '#FBFAF7', boxShadow: '0 24px 50px -30px rgba(20,26,22,0.45), 0 0 0 1px var(--border)' }}>
                            <h3 className="text-[20px] font-normal leading-tight tracking-[-0.03em]" style={{ color: 'var(--foreground)' }}>{c.t}</h3>
                            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{c.d}</p>
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
                <p className="mt-8 text-[12px] font-medium" style={{ color: 'var(--muted-foreground)' }}>Works with</p>
                <div className="mt-3"><WorksWith /></div>
            </Section>

            <Section>
                <Eyebrow>Where it works</Eyebrow>
                <Heading sub="Customers message you the way they already do. Nothing for them to download.">
                    Your customers don&apos;t install anything.
                </Heading>
                <div className="mt-10"><ChannelCards /></div>
                <div className="mt-8"><CTA href="/features" variant="ghost">See everything it does</CTA></div>
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

function FeatureCard({
    variant, title, body, children,
}: {
    variant: number; title: string; body: string; children: React.ReactNode;
}) {
    return (
        <article className="fs-fcard">
            <div className="fs-fmedia">
                <Satin variant={variant} />
                <span className={`fs-flare${variant % 2 ? ' fs-flare--r' : ''}`} aria-hidden />
                {children}
            </div>
            <h3>{title}</h3>
            <p>{body}</p>
        </article>
    );
}
