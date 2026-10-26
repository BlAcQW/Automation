'use client';

import Link from 'next/link';
import { ArrowRight, ChevronRight, MessageCircle, Package, Scissors, Clock } from 'lucide-react';
import { TickPop, cn } from '@bookingflow/ui';
import type { SetupStep } from './use-setup-status';

/**
 * Progress bar for setup. The fill animates with `transform` only (the global
 * reduced-motion rule turns the transition off).
 */
export function SetupProgress({ done, total, className }: { done: number; total: number; className?: string }) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return (
        <div className={className}>
            <div className="flex items-center justify-between gap-3 text-small font-medium">
                <span className="text-text">
                    {done} of {total} done
                </span>
                <span className="text-muted tabular-nums">{pct}%</span>
            </div>
            <div
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                aria-valuetext={`${done} of ${total} steps done`}
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2"
            >
                <div
                    className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-brand-out"
                    style={{ transform: `scaleX(${total === 0 ? 0 : done / total})` }}
                />
            </div>
        </div>
    );
}

const ICONS: Record<SetupStep['key'], typeof MessageCircle> = {
    whatsapp: MessageCircle,
    catalogue: Package,
    hours: Clock,
};

function StepIcon({ step, index }: { step: SetupStep; index: number }) {
    if (step.done) return <TickPop size={36} label={`Step ${index + 1} done`} className="shrink-0" />;
    return (
        <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-border bg-surface text-[15px] font-bold tabular-nums text-muted"
            aria-hidden
        >
            {index + 1}
        </span>
    );
}

/**
 * The step list. `current` (the first unfinished step) is opened up with its
 * explanation and the screen's one gold button; other unfinished steps are a
 * plain row that links to their page; finished steps show the tick.
 */
export function SetupStepList({
    steps,
    current,
    isProduct,
}: {
    steps: SetupStep[];
    current: SetupStep | null;
    isProduct?: boolean;
}) {
    return (
        <ol className="space-y-3">
            {steps.map((step, i) => {
                const Icon = step.key === 'catalogue' ? (isProduct ? Package : Scissors) : ICONS[step.key];
                const isCurrent = current?.key === step.key;
                if (step.done) {
                    return (
                        <li
                            key={step.key}
                            className="flex items-center gap-4 rounded-card border border-border bg-surface px-4 py-3 sm:px-5"
                        >
                            <StepIcon step={step} index={i} />
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-text">{step.title}</p>
                                <p className="text-small text-success-fg">Done</p>
                            </div>
                            <Link
                                href={step.href}
                                className="inline-flex min-h-[44px] items-center rounded-control px-2 text-small font-semibold text-primary hover:underline"
                            >
                                Edit<span className="sr-only">: {step.title}</span>
                            </Link>
                        </li>
                    );
                }
                if (isCurrent) {
                    return (
                        <li
                            key={step.key}
                            aria-current="step"
                            className="rounded-card border-2 border-primary/40 bg-surface p-4 shadow-card sm:p-5"
                        >
                            <div className="flex items-start gap-4">
                                <StepIcon step={step} index={i} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-small font-semibold uppercase tracking-[0.08em] text-primary">
                                        Next up
                                    </p>
                                    <p className="mt-0.5 text-[18px] font-bold leading-snug text-text">{step.title}</p>
                                    <p className="mt-1 text-[15px] leading-relaxed text-muted">{step.detail}</p>
                                    <Link
                                        href={step.href}
                                        className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control bg-accent px-6 font-semibold text-accent-fg shadow-soft transition-colors duration-ui hover:bg-accent-hover active:scale-[0.97] sm:w-auto"
                                    >
                                        <Icon className="h-5 w-5" aria-hidden />
                                        {step.cta}
                                        <ArrowRight className="h-5 w-5" aria-hidden />
                                    </Link>
                                </div>
                            </div>
                        </li>
                    );
                }
                return (
                    <li key={step.key}>
                        <Link
                            href={step.href}
                            className="group flex items-center gap-4 rounded-card border border-border bg-surface px-4 py-3 transition-colors duration-ui hover:bg-surface-2 sm:px-5"
                        >
                            <StepIcon step={step} index={i} />
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-text">{step.title}</p>
                                <p className="text-small text-muted">{step.detail}</p>
                            </div>
                            <ChevronRight
                                className={cn(
                                    'h-5 w-5 shrink-0 text-muted transition-transform duration-ui group-hover:translate-x-0.5',
                                )}
                                aria-hidden
                            />
                        </Link>
                    </li>
                );
            })}
        </ol>
    );
}
