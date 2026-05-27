'use client';

import { Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';
import { GlowButton } from '@/components/primitives/glow-button';
import { PRICING, formatPrice, type DisplayPlan } from '@/lib/pricing-display';
import { cn } from '@/lib/cn';

/**
 * PricingSection — full pricing table embedded on the landing page (owner
 * override of ui.md §7.7 — "not a teaser"). Three tiers driven from
 * `lib/pricing-display.ts` which mirrors the API's plans.ts.
 */
export function PricingSection() {
    return (
        <ScrollReveal id="pricing" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32" stagger>
            {/* Section atmosphere — full-bleed divider + emerald glow centered behind the Pro card. */}
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-screen h-full overflow-hidden -z-10">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-ink-700/40 to-transparent" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] h-[680px] bookly-glow opacity-25" />
            </div>

            <ScrollRevealItem>
                <p className="text-caption uppercase tracking-[0.18em] text-bookly-emerald-400 mb-4 text-center">
                    Pricing
                </p>
                <h2 className="font-display text-display-lg text-ink-50 text-center max-w-3xl mx-auto">
                    Simple, message-based pricing.
                </h2>
                <p className="text-body-lg text-ink-300 text-center max-w-2xl mx-auto mt-5">
                    Start free. Upgrade when your customers do. 14-day Pro trial included on every signup — no credit card.
                </p>
            </ScrollRevealItem>

            <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
                {PRICING.map((plan, idx) => (
                    <ScrollRevealItem
                        key={plan.id}
                        // PRICING is laid out [Free, Pro(featured), Starter] in the array so
                        // desktop reads left-to-right as Free / Pro / Starter. On mobile we
                        // want the featured tier FIRST — reorder via CSS so Pro leads.
                        className={cn(
                            'h-full',
                            plan.featured ? 'order-first md:order-none' : '',
                            idx === 0 ? 'order-2 md:order-none' : '', // Free
                            idx === 2 ? 'order-3 md:order-none' : '', // Starter
                        )}
                    >
                        <PlanCard plan={plan} />
                    </ScrollRevealItem>
                ))}
            </div>

            <ScrollRevealItem>
                <p className="mt-10 text-center text-body-sm text-ink-300">
                    All plans include the WhatsApp inbox, bot builder, and basic analytics. WhatsApp Cloud API fees (paid to Meta) are separate and free for the first 1,000 service conversations per month.
                </p>
            </ScrollRevealItem>
        </ScrollReveal>
    );
}

function PlanCard({ plan }: { plan: DisplayPlan }) {
    return (
        <article
            className={cn(
                'relative h-full flex flex-col rounded-2xl border p-6 sm:p-7 transition-all',
                plan.featured
                    ? 'bg-ink-900 border-bookly-emerald-500/40 shadow-bookly-glow lg:scale-[1.03]'
                    : 'bg-ink-900 border-ink-700 hover:border-bookly-emerald-500/30',
            )}
        >
            {plan.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-bookly-emerald-500 text-ink-1000 px-3 py-1 text-[10px] font-display font-bold uppercase tracking-wider">
                    <Sparkles className="h-3 w-3" />
                    Most popular
                </span>
            )}

            <h3 className="font-display text-h2 text-ink-50">{plan.name}</h3>
            <p className="text-body-sm text-ink-300 mt-1 min-h-[40px]">{plan.tagline}</p>

            <div className="mt-6 flex items-baseline gap-2">
                <span className="font-display font-bold text-display-md text-ink-50 tabular-nums">
                    {formatPrice(plan)}
                </span>
                <span className="text-body-sm text-ink-300">{plan.period}</span>
            </div>

            <ul className="mt-7 space-y-3 flex-1">
                {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-body-sm text-ink-100">
                        <span className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                            plan.featured
                                ? 'bg-bookly-emerald-500/20'
                                : 'bg-ink-800',
                        )}>
                            <Check className={cn('h-3 w-3', plan.featured ? 'text-bookly-emerald-300' : 'text-bookly-emerald-400')} />
                        </span>
                        <span className="leading-relaxed">{f}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-8">
                {plan.featured ? (
                    <GlowButton href={plan.ctaHref} className="w-full">
                        {plan.ctaLabel}
                    </GlowButton>
                ) : (
                    <Link
                        href={plan.ctaHref}
                        className="block w-full text-center rounded-xl border border-ink-700 bg-ink-800/60 px-6 py-3 text-body-sm font-display font-medium text-ink-50 hover:border-ink-600 hover:bg-ink-800 transition-colors"
                    >
                        {plan.ctaLabel}
                    </Link>
                )}
            </div>
        </article>
    );
}
