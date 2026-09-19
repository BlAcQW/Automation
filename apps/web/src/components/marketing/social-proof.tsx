'use client';

import {
    Scissors,
    Sparkles,
    Stethoscope,
    HeartHandshake,
    GraduationCap,
    Shirt,
    Camera,
    Wrench,
} from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';
import { SpotlightCard } from '@/components/primitives/spotlight-card';

/**
 * Who it is for. This replaces a logo marquee and testimonials that were
 * invented; there is nothing to show there yet and pretending otherwise is
 * the fastest way to lose a careful buyer. A list of the businesses the
 * product was built around is true, and it lets a visitor find themselves.
 */
const BUSINESSES = [
    { icon: Scissors, name: 'Hair salons and barbers' },
    { icon: Sparkles, name: 'Nails, lashes and beauty' },
    { icon: HeartHandshake, name: 'Spas and massage' },
    { icon: Stethoscope, name: 'Clinics, dentists and physios' },
    { icon: GraduationCap, name: 'Tutors and coaches' },
    { icon: Shirt, name: 'Tailors and designers' },
    { icon: Camera, name: 'Photographers and studios' },
    { icon: Wrench, name: 'Repairs, cleaning and home services' },
];

export function WhoItsFor() {
    return (
        <ScrollReveal className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-28" stagger>
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-screen h-px bg-ink-700/50" />

            <div className="grid lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-16 items-start">
                <ScrollRevealItem>
                    <h2 className="font-display text-display-lg text-ink-50 text-balance">
                        Built for businesses that already run on WhatsApp.
                    </h2>
                    <p className="mt-5 text-body-lg text-ink-300 max-w-[42ch] text-pretty">
                        If your customers message you to book, and you spend your evenings replying, Bookly was made for you.
                    </p>
                </ScrollRevealItem>

                <ScrollRevealItem>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {BUSINESSES.map(({ icon: Icon, name }) => (
                            <SpotlightCard as="li" key={name} className="rounded-xl">
                                <div className="flex items-center gap-3 px-4 py-3.5">
                                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bookly-emerald-500/10 text-bookly-emerald-400">
                                        <Icon className="h-4 w-4" />
                                    </span>
                                    <span className="text-body-sm font-medium text-ink-50">{name}</span>
                                </div>
                            </SpotlightCard>
                        ))}
                    </ul>
                </ScrollRevealItem>
            </div>
        </ScrollReveal>
    );
}
