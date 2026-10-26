import { type ReactNode } from 'react';
import { SectionHeading } from '@bookingflow/ui';

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <section className="space-y-5">
            <SectionHeading title={title} description={description} />
            {children}
        </section>
    );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-[14px] font-medium text-muted">{label}</p>
            <div className="flex flex-wrap items-center gap-3">{children}</div>
        </div>
    );
}
