'use client';

import { BrandLogo, AwningDivider, PageHeader } from '@bookingflow/ui';
import { Section } from './section';
import { FoundationsSection } from './foundations';
import { ActionsSection, FormsSection } from './controls';
import { DataSection, FeedbackSection } from './feedback';
import { OverlaysSection } from './overlays';
import { ShellPreview } from './shell-preview';

function Gallery({ theme }: { theme: 'light' | 'dark' }) {
    return (
        <div className={theme === 'dark' ? 'dark' : 'light'}>
            <div className="bg-bg px-4 py-10 text-text sm:px-8">
                <div className="mx-auto max-w-6xl space-y-14">
                    <PageHeader
                        eyebrow={theme === 'dark' ? 'Dark theme (planned)' : 'Light theme (default)'}
                        title="Bookly design system"
                        subtitle="Your shop, always open. Every shared component, in one place."
                    />
                    <FoundationsSection />
                    <ActionsSection />
                    <FormsSection />
                    <DataSection />
                    <FeedbackSection />
                    <OverlaysSection />
                    <Section title="App shell" description="Sidebar on desktop, bottom tab bar on phones, awning under the header.">
                        <ShellPreview />
                    </Section>
                </div>
            </div>
        </div>
    );
}

export function DesignSystemShowcase() {
    return (
        <div className="min-h-screen bg-bg">
            <div className="flex items-center justify-between gap-4 bg-surface px-4 py-3 sm:px-8">
                <BrandLogo variant="lockup" size="sm" />
                <a href="#dark" className="inline-flex min-h-[44px] items-center text-[15px] font-semibold text-primary underline-offset-4 hover:underline">
                    Jump to dark
                </a>
            </div>
            <AwningDivider />
            <Gallery theme="light" />
            <div id="dark">
                <AwningDivider tone="gold-green" />
                <Gallery theme="dark" />
            </div>
        </div>
    );
}
