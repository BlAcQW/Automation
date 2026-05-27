'use client';

import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';
import { GlowButton } from '@/components/primitives/glow-button';

/**
 * FinalCTA — ui.md §7.8. Full-bleed, deep dark, oversized emerald glow
 * centered behind the headline. Single primary CTA.
 */
export function FinalCTA() {
    return (
        <ScrollReveal className="relative overflow-hidden py-20 sm:py-32 lg:py-40" stagger>
            {/* Top divider — full-bleed gradient line. */}
            <div aria-hidden className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-ink-700/40 to-transparent" />

            {/* Centered primary glow */}
            <div
                aria-hidden
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[140%] bookly-glow"
            />

            {/* Outer soft halo — fills the corners so the section reads as its own world. */}
            <div
                aria-hidden
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] h-[200%] bookly-glow-soft opacity-60"
            />

            <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <ScrollRevealItem>
                    <h2 className="font-display text-display-xl text-ink-50">
                        Your customers are already on WhatsApp.
                    </h2>
                </ScrollRevealItem>
                <ScrollRevealItem>
                    <h2 className="font-display text-display-xl text-gradient mt-2">
                        Meet them there, professionally.
                    </h2>
                </ScrollRevealItem>
                <ScrollRevealItem>
                    <div className="mt-10">
                        <GlowButton href="/register" size="lg">
                            Start free — 14-day trial of Pro
                        </GlowButton>
                        <p className="mt-4 text-body-sm text-ink-300">
                            No credit card · Cancel anytime
                        </p>
                    </div>
                </ScrollRevealItem>
            </div>
        </ScrollReveal>
    );
}
