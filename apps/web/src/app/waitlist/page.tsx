import Link from 'next/link';
import { SiteShell } from '@/components/marketing/site-shell';
import { PageHero, Section } from '@/components/marketing/primitives';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import { WaitlistForm } from './waitlist-form';

const CRUMBS = [{ name: 'Waitlist', path: '/waitlist' }];

export const metadata = pageMetadata({
    title: 'Join the Bookly waitlist',
    description:
        "Bookly answers your WhatsApp, books real free times and takes the deposit. We're letting businesses in a few at a time: join the waitlist.",
    path: '/waitlist',
});

const NEXT_STEPS = [
    { title: 'We read every request', body: 'A person on the Bookly team looks at your business, not a robot.' },
    { title: 'We message you when it’s your turn', body: 'On WhatsApp or by email, with your own link to sign up.' },
    { title: 'You set up in an afternoon', body: 'Add your services and hours, connect WhatsApp, and Bookly answers the next message.' },
] as const;

/**
 * The public waitlist (self sign-up is closed: lib/feature-flags.ts). The page
 * is static; only the form hydrates. Nothing starts invisible, so it reads
 * fine before JavaScript loads.
 */
export default function WaitlistPage() {
    return (
        <SiteShell jsonLd={[breadcrumbJsonLd(CRUMBS)]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="The waitlist"
                title="Get Bookly for your business."
                sub="We're letting businesses in a few at a time, so everyone gets a proper start. Leave your details and we'll message you when it's your turn."
            />

            <Section labelledBy="waitlist-form-title" className="!pt-8 sm:!pt-12">
                <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-16">
                    <div className="rounded-card-lg border border-border bg-surface p-5 shadow-card sm:p-8">
                        <WaitlistForm />
                    </div>

                    <aside aria-labelledby="waitlist-next" className="lg:sticky lg:top-24">
                        <h2 id="waitlist-next" className="text-[1.25rem] font-bold text-text sm:text-[1.5rem]">What happens next</h2>
                        <ol className="mt-6 space-y-5">
                            {NEXT_STEPS.map((step, i) => (
                                <li key={step.title} className="flex gap-4">
                                    <span
                                        aria-hidden
                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[15px] font-bold text-primary"
                                    >
                                        {i + 1}
                                    </span>
                                    <div>
                                        <h3 className="text-[1.0625rem] font-bold text-text">{step.title}</h3>
                                        <p className="mt-1 text-body text-muted">{step.body}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                        <p className="mt-8 rounded-card border border-border bg-surface-2 p-4 text-body text-muted">
                            Already on Bookly?{' '}
                            <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">Log in</Link>.
                            {' '}Got an invite? Open the link in your message.
                        </p>
                    </aside>
                </div>
            </Section>
        </SiteShell>
    );
}
