import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HeroReveal } from './motion';
import { PhoneChat } from './phone';

/** Home hero. Phone-first: text stacks above the proof, buttons go full-width. */
export function HomeHero() {
    return (
        <section className="glow relative overflow-hidden px-5 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-20">
            <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
                <div>
                    <HeroReveal>
                        <span
                            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                            style={{ background: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
                        >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--primary)' }} />
                            WhatsApp · Instagram · Messenger
                        </span>
                    </HeroReveal>

                    <HeroReveal delay={0.08}>
                        <h1
                            className="font-display mt-5 text-[2.6rem] leading-[1.03] sm:text-6xl"
                            style={{ color: 'var(--foreground)', textWrap: 'balance' }}
                        >
                            Never lose a booking because you were busy.
                        </h1>
                    </HeroReveal>

                    <HeroReveal delay={0.16}>
                        <p className="mt-5 max-w-lg text-[16px] leading-relaxed sm:text-[18px]" style={{ color: 'var(--muted-foreground)' }}>
                            Bookly answers your customers while you&apos;re working, books them into
                            times you&apos;re really free, and takes a deposit so they actually show up.
                        </p>
                    </HeroReveal>

                    <HeroReveal delay={0.24}>
                        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                            <Link
                                href="/register"
                                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold"
                                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                            >
                                Get started free <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link
                                href="/features"
                                className="inline-flex min-h-[52px] items-center justify-center rounded-xl px-6 text-[15px] font-medium"
                                style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
                            >
                                See what it does
                            </Link>
                        </div>
                        <p className="mt-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                            No payment gateway to set up. No card to start.
                        </p>
                    </HeroReveal>
                </div>

                <HeroReveal delay={0.2}>
                    <PhoneChat />
                </HeroReveal>
            </div>
        </section>
    );
}
