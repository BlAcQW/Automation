'use client';

/**
 * "6 of 10 sections filled": a segmented bar (one segment per section, in page
 * order) and links to the sections still empty. Words + count, never colour
 * alone.
 */
import { Card, cn } from '@bookingflow/ui';
import { SECTIONS, sectionTitle, type BusinessType, type SectionId } from './knowledge-fields';

interface CompletenessProps {
    filled: SectionId[];
    missing: SectionId[];
    total: number;
    businessType: BusinessType;
}

export function Completeness({ filled, missing, total, businessType }: CompletenessProps) {
    const done = filled.length;
    const all = done === total;
    return (
        <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-base font-semibold text-text" aria-live="polite">
                    {done} of {total} sections filled
                </p>
                <p className="text-[14px] text-muted">
                    {all ? 'Your assistant has everything it needs.' : done === 0 ? 'Start with any section.' : 'The more you add, the less it hands over.'}
                </p>
            </div>
            <ol className="mt-3 grid grid-cols-10 gap-1" aria-hidden>
                {SECTIONS.map((s) => (
                    <li key={s.id} className={cn('h-2 rounded-full', filled.includes(s.id) ? 'bg-primary' : 'bg-surface-2')} />
                ))}
            </ol>
            {!all && missing.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[14px] text-muted">Still empty:</span>
                    {missing.map((id) => {
                        const s = SECTIONS.find((x) => x.id === id)!;
                        return (
                            <a
                                key={id}
                                href={`#section-${id}`}
                                className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface px-3 text-[14px] font-medium text-text transition-colors duration-ui hover:bg-surface-2"
                            >
                                {sectionTitle(s, businessType)}
                            </a>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}
