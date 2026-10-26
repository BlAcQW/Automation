import { Section } from './primitives';

/**
 * Long-form legal reading: a single 68ch column on a white sheet, 16px+
 * body, generous line height. Links are underlined and green.
 */
export function LegalArticle({ updated, children }: { updated: string; children: React.ReactNode }) {
    return (
        <Section labelledBy={undefined} className="!pt-10">
            <article className="mx-auto max-w-[68ch] rounded-card-lg border border-border bg-surface px-5 py-8 shadow-card sm:px-10 sm:py-12">
                <p className="text-small font-medium text-muted">Last updated: {updated}</p>
                {children}
            </article>
        </Section>
    );
}

/** One numbered clause. */
export function Clause({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
    return (
        <section id={id} className="mt-10 scroll-mt-24 border-t border-border pt-8 first-of-type:mt-6">
            <h2 className="mb-4 text-section-heading text-text">{title}</h2>
            <div className="space-y-3 text-body leading-[1.7] text-text/90 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_strong]:text-text">
                {children}
            </div>
        </section>
    );
}
