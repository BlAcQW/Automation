import { ArrowRight } from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import { ButtonLink, ClosingCTA, Section, SectionTitle, SignupLink, PageHero } from '@/components/marketing/primitives';
import { IndustryCards, ChannelCards, JobsGrid, NoSetupBlock, StepsList } from '@/components/marketing/sections';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';

const CRUMBS = [{ name: 'What it does', path: '/features' }];

export const metadata = pageMetadata({
    title: 'What Bookly does: bookings, deposits, reminders',
    description:
        'Answers customers while you work, books real free times, takes Mobile Money deposits, sends reminders and keeps your customer list yours.',
    path: '/features',
});

export default function FeaturesPage() {
    return (
        <SiteShell current="/features" jsonLd={[breadcrumbJsonLd(CRUMBS)]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="What it does"
                title="A front desk that never takes lunch."
                sub="Seven jobs Bookly takes off your hands, in the order you'll feel them."
            >
                <SignupLink>Start free</SignupLink>
                <ButtonLink href="/features/whatsapp-bookings" variant="secondary">
                    How WhatsApp bookings work <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
            </PageHero>

            <Section labelledBy="jobs">
                <h2 id="jobs" className="sr-only">Seven jobs Bookly does for you</h2>
                <JobsGrid />
            </Section>

            <Section tone="soft" labelledBy="no-setup">
                <NoSetupBlock headingId="no-setup" />
            </Section>

            <Section labelledBy="channels">
                <SectionTitle id="channels" eyebrow="Where it works" title="Three inboxes, one place." sub="One assistant and one diary behind every channel." />
                <div className="mt-10"><ChannelCards /></div>
            </Section>

            <Section tone="green" labelledBy="steps">
                <SectionTitle id="steps" inverse eyebrow="Getting started" title="Three steps, once." sub="Most people are taking bookings the same afternoon." />
                <div className="mt-10"><StepsList inverse /></div>
            </Section>

            <Section tone="surface" labelledBy="made-for">
                <SectionTitle
                    id="made-for"
                    eyebrow="Who it's for"
                    title="Anything booked by appointment."
                    sub="Skin clinics, spas, dental clinics, tailors, private chefs, photographers, pilates studios and car detailers. If clients book you, Bookly fits."
                />
                <div className="mt-10"><IndustryCards /></div>
            </Section>

            <ClosingCTA title="Try it on your own number." sub="Free to start. Nothing to set up first." />
        </SiteShell>
    );
}
