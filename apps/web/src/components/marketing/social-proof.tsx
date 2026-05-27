'use client';

import { Quote } from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';

const LOGOS = ['ATELIER', 'KIM & CO', 'GIMPERS', 'LessData', 'URBAN THREADS', 'NEXA', 'HERTZ', 'PAYGATE'];

const TESTIMONIALS = [
    {
        quote:
            "Within a week our missed-call problem vanished. The bot books appointments while we're cutting hair — and the reminders cut no-shows by 60%.",
        name: 'Akosua A.',
        business: 'Akosua Hair Studio',
        country: 'Ghana',
    },
    {
        quote:
            "We replaced a $300/mo phone system and two part-time receptionists with Bookly. Customers love that it just feels like WhatsApp.",
        name: 'Kwame O.',
        business: 'Premier Wellness Clinic',
        country: 'Ghana',
    },
    {
        quote:
            "Our weekend bookings doubled because the bot is open when we're not. Setup took an afternoon, not a quarter.",
        name: 'Adaeze N.',
        business: 'Lagos Tutoring Co.',
        country: 'Nigeria',
    },
];

/**
 * SocialProof — ui.md §7.6. Marquee of logos + 3-card testimonial row.
 */
export function SocialProof() {
    return (
        <section className="relative py-16 sm:py-24 lg:py-32 overflow-hidden">
            {/* Section atmosphere — full-bleed divider + soft center glow. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-ink-700/40 to-transparent" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[300px] bookly-glow-soft opacity-50" />
            </div>

            {/* Logo marquee */}
            <div className="relative">
                <p className="text-caption uppercase tracking-[0.18em] text-ink-300 mb-8 text-center">
                    Powering teams across West Africa
                </p>
                <div className="relative">
                    {/* Edge fades */}
                    <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-ink-950 to-transparent z-10 pointer-events-none" />
                    <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-ink-950 to-transparent z-10 pointer-events-none" />
                    <div className="flex gap-16 animate-marquee whitespace-nowrap">
                        {[...LOGOS, ...LOGOS].map((name, i) => (
                            <span
                                key={`${name}-${i}`}
                                className="font-display font-semibold tracking-[0.18em] text-ink-300 hover:text-ink-50 transition-colors text-h3"
                            >
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Testimonials — desktop/tablet only; hidden on mobile per owner request. */}
            <ScrollReveal className="hidden md:block relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24" stagger>
                <ScrollRevealItem>
                    <h2 className="font-display text-display-lg text-ink-50 text-center max-w-3xl mx-auto mb-14">
                        Loved by the people running the business.
                    </h2>
                </ScrollRevealItem>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {TESTIMONIALS.map((t) => (
                        <ScrollRevealItem key={t.name}>
                            <TestimonialCard {...t} />
                        </ScrollRevealItem>
                    ))}
                </div>
            </ScrollReveal>

            <style jsx>{`
                @keyframes marquee {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
                .animate-marquee {
                    animation: marquee 40s linear infinite;
                }
                .animate-marquee:hover {
                    animation-play-state: paused;
                }
            `}</style>
        </section>
    );
}

function TestimonialCard({
    quote,
    name,
    business,
    country,
}: {
    quote: string;
    name: string;
    business: string;
    country: string;
}) {
    return (
        <article className="h-full rounded-2xl border border-ink-700 bg-ink-900 p-6 sm:p-7 transition-colors hover:border-bookly-emerald-500/30">
            <Quote className="h-6 w-6 text-bookly-emerald-400/60 mb-4" />
            <p className="text-body text-ink-100 leading-relaxed mb-6">"{quote}"</p>
            <div className="flex items-center gap-3 pt-4 border-t border-ink-700">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-bookly-emerald-400 to-bookly-emerald-600 flex items-center justify-center font-display font-bold text-ink-1000">
                    {name.charAt(0)}
                </div>
                <div className="min-w-0">
                    <p className="text-body-sm font-semibold text-ink-50">{name}</p>
                    <p className="text-caption uppercase tracking-wider text-ink-300">
                        {business} · {country}
                    </p>
                </div>
            </div>
        </article>
    );
}
