'use client';

import { ArrowRight } from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';
import { GlowButton } from '@/components/primitives/glow-button';

/** Last section. One sentence, one button, same label as the hero. */
export function FinalCTA() {
    return (
        <ScrollReveal className="relative overflow-hidden py-20 sm:py-28 lg:py-32" stagger>
            <div aria-hidden className="absolute top-0 inset-x-0 h-px bg-ink-700/50" />
            <div
                aria-hidden
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[120%] bookly-glow"
            />

            <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <ScrollRevealItem>
                    <h2 className="font-display text-display-lg text-ink-50 text-balance">
                        Your customers are already on WhatsApp. Let them book there.
                    </h2>
                </ScrollRevealItem>
                <ScrollRevealItem>
                    <div className="mt-9">
                        <GlowButton href="/register" size="lg">
                            Start free
                            <ArrowRight className="w-4 h-4" />
                        </GlowButton>
                        <p className="mt-4 text-body-sm text-ink-300">
                            14-day trial of Pro. No card needed. Cancel any time.
                        </p>
                    </div>
                </ScrollRevealItem>
            </div>
        </ScrollReveal>
    );
}
