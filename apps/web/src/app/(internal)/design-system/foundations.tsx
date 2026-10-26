'use client';

import { AwningDivider, BrandLogo, Button } from '@bookingflow/ui';
import { Row, Section } from './section';

const SEMANTIC = [
    ['bg', 'bg-bg'],
    ['surface', 'bg-surface'],
    ['surface-2', 'bg-surface-2'],
    ['text', 'bg-text'],
    ['muted', 'bg-muted'],
    ['border', 'bg-border'],
    ['primary', 'bg-primary'],
    ['primary-hover', 'bg-primary-hover'],
    ['primary-soft', 'bg-primary-soft'],
    ['accent', 'bg-accent'],
    ['accent-hover', 'bg-accent-hover'],
    ['accent-soft', 'bg-accent-soft'],
    ['success', 'bg-success'],
    ['warning', 'bg-warning'],
    ['error', 'bg-error'],
    ['charcoal', 'bg-charcoal'],
    ['cream', 'bg-cream'],
] as const;

export function FoundationsSection() {
    return (
        <>
            <Section title="Logo" description="Logo work is on hold: plain text Bookly, and the existing app icon where a square mark is needed. Swapped in one place later.">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-wrap items-center gap-6 rounded-card border border-border bg-surface p-6 shadow-card">
                        <BrandLogo variant="wordmark" size="lg" />
                        <BrandLogo variant="icon" size="lg" />
                        <BrandLogo variant="lockup" size="md" />
                    </div>
                    <div className="flex flex-wrap items-center gap-6 rounded-card bg-charcoal p-6 shadow-card">
                        <BrandLogo variant="wordmark" size="lg" tone="inverse" />
                        <BrandLogo variant="lockup" size="md" tone="inverse" />
                    </div>
                </div>
            </Section>

            <Section title="Awning divider" description="The signature stripe. Once per view: dashboard header, marketing section breaks.">
                <div className="space-y-4 rounded-card border border-border bg-surface p-5 shadow-card">
                    <AwningDivider size="sm" />
                    <AwningDivider />
                    <AwningDivider tone="gold-green" size="lg" />
                    <AwningDivider tone="solid" />
                </div>
            </Section>

            <Section title="Colour" description="Semantic tokens flip with the theme. 60% background · 30% green · 10% gold.">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {SEMANTIC.map(([name, cls]) => (
                        <div key={name} className="overflow-hidden rounded-control border border-border bg-surface">
                            <div className={`h-14 ${cls}`} />
                            <p className="px-3 py-2 font-mono text-[13px] text-text">{name}</p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="Type" description="Clash Display for logo, page titles and hero only. Bricolage Grotesque for everything else.">
                <div className="space-y-4 rounded-card border border-border bg-surface p-6 shadow-card">
                    <p className="font-display text-hero text-text">Your shop, always open.</p>
                    <p className="font-display text-page-title text-text">Your bookings</p>
                    <p className="text-section-heading text-text">Today&apos;s appointments</p>
                    <p className="text-body text-text">Body 16px — customers book on WhatsApp and you see it here, right away.</p>
                    <p className="text-small text-muted">Small / label 14px — Last updated 2 minutes ago</p>
                </div>
            </Section>

            <Section title="Radius, spacing, shadow">
                <Row label="rounded-control 12 · rounded-card 20 · rounded-card-lg 24 · shadow-soft / card / card-lg / lift">
                    <div className="h-16 w-24 rounded-control border border-border bg-surface shadow-soft" />
                    <div className="h-16 w-24 rounded-card border border-border bg-surface shadow-card" />
                    <div className="h-16 w-24 rounded-card-lg border border-border bg-surface shadow-card-lg" />
                    <div className="h-16 w-24 rounded-card border border-border bg-surface shadow-lift" />
                </Row>
                <Row label="4px scale: 4 8 12 16 24 32 48 64">
                    {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
                        <div key={n} className="bg-primary/80" style={{ width: n * 4, height: 24 }} title={`${n * 4}px`} />
                    ))}
                </Row>
            </Section>
        </>
    );
}
