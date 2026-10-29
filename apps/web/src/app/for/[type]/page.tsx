import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info, AlertTriangle } from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import {
    ButtonLink, CheckList, ClosingCTA, PageHero, Panel, Section, SectionTitle, SignupLink,
} from '@/components/marketing/primitives';
import { BusinessTypeCards, FaqList, Shopfront, StepsList } from '@/components/marketing/sections';
import { BUSINESS_PAGES } from '@/components/marketing/business-pages';
import { BUSINESS_TYPES, type BusinessType } from '@/components/marketing/content';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';

/** Clean URLs: /for/salons, /for/boutiques, /for/food-vendors. All static. */
export const dynamicParams = false;

export function generateStaticParams() {
    return BUSINESS_TYPES.map((b) => ({ type: b.slug }));
}

function getPage(type: string) {
    return (BUSINESS_PAGES as Record<string, (typeof BUSINESS_PAGES)[BusinessType['slug']] | undefined>)[type];
}

export function generateMetadata({ params }: { params: { type: string } }) {
    const page = getPage(params.type);
    if (!page) return {};
    return pageMetadata({ title: page.seoTitle, description: page.seoDescription, path: `/for/${page.slug}` });
}

export default function BusinessTypePage({ params }: { params: { type: string } }) {
    const page = getPage(params.type);
    if (!page) notFound();
    const crumbs = [{ name: page.crumb, path: `/for/${page.slug}` }];

    return (
        <SiteShell jsonLd={[breadcrumbJsonLd(crumbs), faqJsonLd(page.faq)]}>
            <PageHero crumbs={crumbs} eyebrow={page.eyebrow} title={page.title} sub={page.sub}>
                <SignupLink />
                <ButtonLink href="/features/whatsapp-bookings" variant="secondary">How it works</ButtonLink>
            </PageHero>

            <Section labelledBy="examples">
                <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
                    <div>
                        <SectionTitle id="examples" eyebrow="On WhatsApp" title={page.examplesTitle} />
                        <CheckList items={page.examples} className="mt-8" />
                        {page.note && (
                            <p className="mt-8 flex gap-3 rounded-card border border-border bg-surface-2 p-4 text-body text-text">
                                <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                                <span>{page.note}</span>
                            </p>
                        )}
                    </div>
                    <Shopfront />
                </div>
            </Section>

            <Section tone="soft" labelledBy="pains">
                <SectionTitle id="pains" eyebrow="The leaks" title={page.painsTitle} />
                <ul className="mt-10 grid gap-4 md:grid-cols-3">
                    {page.pains.map((p) => (
                        <li key={p.title}>
                            <Panel className="h-full">
                                <AlertTriangle className="h-6 w-6 text-warning-fg" aria-hidden />
                                <h3 className="mt-4 text-[1.125rem] font-bold text-text">{p.title}</h3>
                                <p className="mt-1.5 text-body text-muted">{p.body}</p>
                            </Panel>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section tone="green" labelledBy="steps">
                <SectionTitle id="steps" inverse eyebrow="Getting started" title="Three steps, once." sub="Most people are taking bookings the same afternoon." />
                <div className="mt-10"><StepsList inverse /></div>
            </Section>

            <Section labelledBy="questions">
                <SectionTitle id="questions" eyebrow="Questions" title="What people ask us." />
                <div className="mt-8 max-w-3xl"><FaqList items={page.faq} /></div>
                <p className="mt-6 text-body text-muted">
                    See <Link href="/features" className="font-semibold text-primary underline underline-offset-4">everything Bookly does</Link>
                    {' '}or read <Link href="/faq" className="font-semibold text-primary underline underline-offset-4">more questions</Link>.
                </p>
            </Section>

            <Section tone="surface" labelledBy="others">
                <SectionTitle id="others" eyebrow="Also made for" title="Run a different kind of shop?" />
                <div className="mt-10"><BusinessTypeCards exclude={page.slug} /></div>
            </Section>

            <ClosingCTA title={page.closing.title} sub={page.closing.sub} />
        </SiteShell>
    );
}
