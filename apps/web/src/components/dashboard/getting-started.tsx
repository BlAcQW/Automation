'use client';

import { useAuth } from '@/lib/auth';
import { SectionHeading } from '@bookingflow/ui';
import { useSetupStatus } from '@/components/onboarding/use-setup-status';
import { SetupProgress, SetupStepList } from '@/components/onboarding/setup-steps';

/**
 * The first thing a new owner sees on the dashboard: the short setup
 * checklist (connect WhatsApp, add services or products, set hours) with a
 * progress bar. It vanishes once every step is done.
 *
 * Same export and no props as before, so the dashboard page mounts it as-is.
 * The full-page version lives at /onboarding.
 */
export function GettingStarted() {
    const { tenant } = useAuth();
    const { steps, doneCount, current, isLoading, isError } = useSetupStatus();

    // Still loading (don't flash "0 of 3" at someone who is done), a failed
    // check (the rest of the dashboard still works), or all done: show nothing.
    if (isLoading || isError || current === null) return null;

    return (
        <section aria-label="Get set up" className="rounded-card bg-surface p-4 shadow-card sm:p-6">
            <SectionHeading
                title={doneCount === 0 ? "Let's get your shop open" : 'Almost there'}
                description="A few quick steps and customers can book or order just by sending you a WhatsApp message."
            />
            <SetupProgress done={doneCount} total={steps.length} className="mt-4 mb-5" />
            <SetupStepList steps={steps} current={current} isProduct={tenant?.businessType === 'PRODUCT'} />
        </section>
    );
}
