import { ArrowRight } from 'lucide-react';
import { cx as cn } from '@/components/marketing/cx';
import { SiteShell } from '@/components/marketing/site-shell';
import {
    Awning, ButtonLink, Container, Panel, Section, SectionTitle, SignupLink, ClosingCTA, motionStyles as m,
} from '@/components/marketing/primitives';
import {
    ChannelCards, IndustryCards, JobsGrid, NoSetupBlock, StepsList,
} from '@/components/marketing/sections';
import { ChatDemo } from '@/components/marketing/chat-demo';
import { LEAKS } from '@/components/marketing/content';
import { pageMetadata, softwareApplicationJsonLd } from '@/lib/seo';
import { SITE_TAGLINE } from '@/lib/site';
import { SIGNUP_REASSURANCE } from '@/lib/signup-cta';
import { RotatingChannel } from '@/components/brand/rotating-channel';

export const metadata = pageMetadata({
    title: 'Bookly: WhatsApp booking system for Ghana businesses',
    description:
        'Your shop, always open. Bookly answers WhatsApp while you work, books real free times, takes the deposit by Mobile Money and sends the reminder.',
    path: '/',
});

/**
 * Home. A typographic hero (the tagline in Clash Display) next to a live
 * chat demo over a client photo, then the honest sections. Every number on the
 * page is something Bookly does, never a customer count.
 */
export default function HomePage() {
    return (
        <SiteShell current="/" jsonLd={[softwareApplicationJsonLd()]}>
            {/* Hero */}
            <header className="bg-bg">
                <Container className="grid items-center gap-8 pb-12 pt-6 sm:gap-12 sm:pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-20 lg:pt-16">
                    {/* Centred while stacked so it lines up with the phone below; left-aligned beside it on desktop. */}
                    <div className="mx-auto max-w-xl text-center lg:mx-0 lg:max-w-none lg:text-left">
                        <p className={cn('hidden text-small font-semibold uppercase tracking-[0.08em] text-primary sm:block', m.enter)}>
                            Bookings on WhatsApp, Instagram and Messenger
                        </p>
                        <h1 className={cn('font-display text-hero text-text [text-wrap:balance] sm:mt-4', m.enterTitle)}>
                            {SITE_TAGLINE}
                        </h1>
                        {/* Phones get one short line so the chat demo shows at first glance. */}
                        <p className={cn('mt-3 text-[1.0625rem] text-muted sm:hidden', m.enter, m.d1)}>
                            Bookly books your clients on <RotatingChannel /> and takes the deposit.
                        </p>
                        <p className={cn('mt-5 hidden max-w-xl text-xl leading-relaxed text-muted sm:mx-auto sm:block lg:mx-0', m.enter, m.d1)}>
                            Bookly answers your <RotatingChannel /> while you work. It books customers into times you&apos;re really
                            free, takes the deposit by Mobile Money and sends the reminder, so they show up.
                        </p>
                        <div className={cn('mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:flex sm:justify-center lg:justify-start', m.enter, m.d2)}>
                            <SignupLink size="xl" className="px-3 sm:px-7" arrow />
                            <ButtonLink href="/features" variant="secondary" size="xl" className="px-3 sm:px-7">
                                <span className="sm:hidden">How it works</span>
                                <span className="hidden sm:inline">See what it does</span>
                            </ButtonLink>
                        </div>
                        <p className={cn('mt-4 hidden text-small text-muted sm:block', m.enter, m.d3)}>
                            {SIGNUP_REASSURANCE}
                        </p>
                    </div>
                    <div className={cn('relative mx-auto w-full max-w-md lg:max-w-none', m.enter, m.d2)}>
                        {/* A client checking her phone; the chat below is what she sees. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/images/marketing/clinic-client-640.webp"
                            srcSet="/images/marketing/clinic-client-640.webp 640w, /images/marketing/clinic-client-960.webp 960w"
                            sizes="(min-width: 1024px) 340px, 0px"
                            width={640}
                            height={800}
                            alt=""
                            decoding="async"
                            className="absolute right-0 top-0 hidden aspect-[4/5] w-[56%] rounded-card-lg object-cover shadow-card-lg lg:block"
                        />
                        <ChatDemo className="relative lg:mr-auto lg:w-[72%] lg:pt-16" />
                    </div>
                </Container>
            </header>

            <Awning />

            {/* The two leaks */}
            <Section labelledBy="leaks">
                <SectionTitle
                    id="leaks"
                    eyebrow="Where the bookings go"
                    title="Two leaks, and both of them are money."
                    sub="Not admin. Two specific moments where a customer slips away."
                />
                <ul className="mt-10 grid gap-4 sm:grid-cols-2">
                    {LEAKS.map(({ icon: Icon, title, body }) => (
                        <li key={title}>
                            <Panel className="h-full">
                                <Icon className="h-6 w-6 text-primary" aria-hidden />
                                <h3 className="mt-4 text-[1.125rem] font-bold text-text">{title}</h3>
                                <p className="mt-1.5 text-body text-muted">{body}</p>
                            </Panel>
                        </li>
                    ))}
                </ul>
                <p className="mt-8 max-w-2xl text-[1.0625rem] font-medium text-text">
                    Bookly answers while you&apos;re mid-job, offers only the times you&apos;re really free, and holds
                    the slot with a deposit.
                </p>
            </Section>

            {/* How it works */}
            <Section tone="green" labelledBy="how">
                <SectionTitle
                    id="how"
                    inverse
                    eyebrow="How it works"
                    title="Three steps, once. Then it just runs."
                    sub="Most people are taking bookings the same afternoon."
                />
                <div className="mt-10"><StepsList inverse /></div>
            </Section>

            {/* What it does */}
            <Section labelledBy="jobs">
                <SectionTitle
                    id="jobs"
                    eyebrow="What it does"
                    title="A front desk that never takes lunch."
                    sub="The jobs Bookly takes off your hands, in the order you'll feel them."
                />
                <div className="mt-10"><JobsGrid limit={6} /></div>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <ButtonLink href="/features" variant="secondary">Everything it does</ButtonLink>
                    <ButtonLink href="/features/whatsapp-bookings" variant="ghost">
                        How WhatsApp bookings work <ArrowRight className="h-4 w-4" aria-hidden />
                    </ButtonLink>
                </div>
            </Section>

            <Section tone="soft" labelledBy="no-setup">
                <NoSetupBlock headingId="no-setup" />
            </Section>

            {/* Channels */}
            <Section labelledBy="channels">
                <SectionTitle
                    id="channels"
                    eyebrow="Where it works"
                    title="Your customers don't install anything."
                    sub="They message you the way they already do. One assistant and one diary behind every channel."
                />
                <div className="mt-10"><ChannelCards /></div>
            </Section>

            {/* Business types */}
            <Section tone="surface" labelledBy="made-for">
                <SectionTitle
                    id="made-for"
                    eyebrow="Made for"
                    title="Built for businesses where every booking is worth it."
                    sub="When one appointment is worth hundreds of cedis, a slow reply or a no-show costs real money. Bookly answers in seconds and takes the deposit first."
                />
                <div className="mt-10"><IndustryCards /></div>
            </Section>

            <ClosingCTA
                title="Stop losing bookings because you were busy."
                sub="Set it up this afternoon. Bookly answers the next message that comes in."
                waitlist={{ sub: "Join the waitlist. When it's your turn, set it up in an afternoon and Bookly answers the next message that comes in." }}
            />
        </SiteShell>
    );
}
