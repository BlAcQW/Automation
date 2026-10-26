'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { BrandLogo, ErrorState, SkeletonCard, SkeletonLine, TickPop } from '@bookingflow/ui';
import { useSetupStatus } from '@/components/onboarding/use-setup-status';
import { SetupProgress, SetupStepList } from '@/components/onboarding/setup-steps';

/**
 * Where new sign-ups land: a short, focused setup (no sidebar) with a progress
 * bar. Each step links to the page that already does it; finished steps tick.
 * Signed-out visitors are sent to log in by useRequireAuth.
 */
export default function OnboardingPage() {
    const { isLoading: authLoading } = useRequireAuth();

    return (
        <div className="min-h-[100dvh] bg-bg text-text">
            <header className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 pt-6 sm:px-6">
                <BrandLogo size="md" />
                <Link
                    href="/dashboard"
                    className="inline-flex min-h-[44px] items-center rounded-control px-2 text-[15px] font-medium text-muted transition-colors duration-ui hover:text-text"
                >
                    Skip for now
                </Link>
            </header>
            <main id="main" className="mx-auto max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
                {authLoading ? <OnboardingSkeleton /> : <OnboardingBody />}
            </main>
        </div>
    );
}

function OnboardingBody() {
    const { tenant, user } = useAuth();
    const { steps, doneCount, current, isLoading, isError, retry } = useSetupStatus();
    const firstName = user?.name?.split(' ')[0];

    if (isLoading) return <OnboardingSkeleton />;

    if (isError) {
        return (
            <>
                <h1 className="font-display text-page-title">Let&apos;s get your shop open</h1>
                <ErrorState
                    className="mt-6 rounded-card bg-surface shadow-card"
                    description="We couldn't check your setup just now. Check your internet connection, then tap Try again."
                    onRetry={retry}
                />
            </>
        );
    }

    if (current === null) {
        return (
            <div className="rounded-card-lg bg-surface p-6 text-center shadow-card sm:p-10">
                <TickPop size={72} label="Setup complete" className="mx-auto" />
                <h1 className="mt-6 font-display text-page-title">You&apos;re open for business!</h1>
                <p className="mx-auto mt-3 max-w-[40ch] text-body text-muted">
                    Everything is set up. Share your WhatsApp number and your first bookings will show up on your
                    dashboard.
                </p>
                <Link
                    href="/dashboard"
                    className="mt-8 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover"
                >
                    Go to my dashboard <ArrowRight className="h-5 w-5" aria-hidden />
                </Link>
            </div>
        );
    }

    return (
        <>
            <p className="text-small font-semibold uppercase tracking-[0.1em] text-primary">
                Step {steps.indexOf(current) + 1} of {steps.length}
            </p>
            <h1 className="mt-2 font-display text-page-title">
                {firstName ? `Welcome, ${firstName}! ` : 'Welcome! '}
                Let&apos;s get your shop open
            </h1>
            <p className="mt-3 max-w-[52ch] text-body text-muted">
                {steps.length === 3 ? 'Three' : 'A few'} quick steps and customers can{' '}
                {tenant?.businessType === 'PRODUCT' ? 'order' : 'book'} just by sending you a WhatsApp message. You can
                come back to this any time from your dashboard.
            </p>

            <SetupProgress done={doneCount} total={steps.length} className="mt-8 mb-6" />
            <SetupStepList steps={steps} current={current} isProduct={tenant?.businessType === 'PRODUCT'} />

            <p className="mt-8 text-center">
                <Link
                    href="/dashboard"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control px-2 text-[15px] font-semibold text-primary hover:underline"
                >
                    I&apos;ll finish later, take me to my dashboard
                </Link>
            </p>
        </>
    );
}

function OnboardingSkeleton() {
    return (
        <div aria-busy="true" className="space-y-4">
            <span className="sr-only">Loading…</span>
            <SkeletonLine className="h-4 w-24" />
            <SkeletonLine className="h-10 w-3/4" />
            <SkeletonLine className="h-4 w-full" />
            <SkeletonLine className="mt-6 h-2.5 w-full" />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
        </div>
    );
}
