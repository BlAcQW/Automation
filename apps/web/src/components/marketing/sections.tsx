import Link from 'next/link';
import { ArrowRight, Check, CheckCircle2, Clock3, Plus, Store } from 'lucide-react';
import { AwningDivider, formatCedi } from '@bookingflow/ui';
import { cx as cn } from './cx';
import {
    BUSINESS_TYPES, CHANNELS, COMPARISON, INDUSTRIES, JOBS, NO_SETUP_POINTS, STEPS, WORKS_WITH,
    type BusinessType, type QA,
} from './content';
import { CheckList, Panel, SectionTitle } from './primitives';
import styles from './marketing.module.css';

/* ------------------------------------------------------------------ */
/* Hero visual: a shopfront with today's diary and a confirmed booking */
/* ------------------------------------------------------------------ */

const SLOTS = [
    { t: '9:00', state: 'booked' },
    { t: '11:00', state: 'free' },
    { t: '1:00', state: 'booked' },
    { t: '2:30', state: 'booked' },
    { t: '4:30', state: 'chosen' },
    { t: '6:00', state: 'free' },
] as const;

/**
 * An illustration of the product for an example shop, not a claim about
 * anyone's numbers. A shop under an awning: the day's free times, and the
 * booking Bookly just confirmed with its deposit.
 */
export function Shopfront({ className }: { className?: string }) {
    return (
        <figure className={cn('relative mx-auto w-full max-w-md', className)}>
            <div className="overflow-hidden rounded-card-lg border border-border bg-surface shadow-card-lg">
                <AwningDivider tone="gold-green" size="lg" />
                <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-control bg-primary-soft text-primary" aria-hidden>
                                <Store className="h-5 w-5" />
                            </span>
                            <div>
                                <p className="text-[15px] font-semibold text-text">Maison Skin Clinic</p>
                                <p className="text-small text-muted">Thursday · East Legon, Accra</p>
                            </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-small font-semibold text-success-fg">
                            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
                            Open
                        </span>
                    </div>

                    <p className="mt-5 text-small font-medium text-muted">Free times today</p>
                    <ul className="mt-2 grid grid-cols-3 gap-2">
                        {SLOTS.map((s) => (
                            <li
                                key={s.t}
                                className={cn(
                                    'flex min-h-[40px] flex-col items-center justify-center rounded-control text-[14px] font-semibold tabular-nums',
                                    s.state === 'chosen' && 'bg-primary text-primary-fg',
                                    s.state === 'booked' && 'bg-surface-2 text-muted line-through',
                                    s.state === 'free' && 'border border-border text-text',
                                )}
                            >
                                {s.t}
                                <span className="sr-only">{s.state === 'booked' ? ' (taken)' : s.state === 'chosen' ? ' (just booked)' : ' (free)'}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-5 rounded-card border border-border bg-bg p-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                            <div className="min-w-0 flex-1">
                                <p className="text-[15px] font-semibold text-text">Booking confirmed</p>
                                <p className="text-small text-muted">Efua A. · HydraFacial · Thu 4:30 pm</p>
                            </div>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-small">
                            <div>
                                <dt className="text-muted">Deposit paid</dt>
                                <dd className="font-semibold tabular-nums text-text">{formatCedi(200)}</dd>
                            </div>
                            <div>
                                <dt className="text-muted">Paid with</dt>
                                <dd className="font-semibold text-text">MTN MoMo</dd>
                            </div>
                        </dl>
                        <p className="mt-3 flex items-center gap-1.5 text-small text-muted">
                            <Clock3 className="h-3.5 w-3.5" aria-hidden />
                            Reminder goes out Wednesday evening
                        </p>
                    </div>
                </div>
            </div>
            <figcaption className="mt-3 text-center text-small text-muted">Example: a Thursday at a made-up clinic. Your diary, your prices.</figcaption>
        </figure>
    );
}

/* ------------------------------------------------------------------ */

export function JobsGrid({ limit }: { limit?: number }) {
    const jobs = limit ? JOBS.slice(0, limit) : JOBS;
    return (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                    <Panel lift className="h-full">
                        <span className="inline-flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary" aria-hidden>
                            <Icon className="h-5 w-5" />
                        </span>
                        <h3 className="mt-4 text-[1.125rem] font-bold text-text">{title}</h3>
                        <p className="mt-1.5 text-body text-muted">{body}</p>
                    </Panel>
                </li>
            ))}
        </ul>
    );
}

export function StepsList({ inverse }: { inverse?: boolean }) {
    return (
        <ol className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
                <li key={s.title} className={cn('border-t-2 pt-5', inverse ? 'border-cream/30' : 'border-primary')}>
                    <span className={cn('font-display text-[2.5rem] font-semibold leading-none tabular-nums', inverse ? 'text-accent' : 'text-primary')} aria-hidden>
                        {i + 1}
                    </span>
                    <h3 className={cn('mt-3 text-[1.125rem] font-bold', inverse ? 'text-cream' : 'text-text')}>{s.title}</h3>
                    <p className={cn('mt-1.5 text-body', inverse ? 'text-cream/90' : 'text-muted')}>{s.body}</p>
                </li>
            ))}
        </ol>
    );
}

export function ChannelCards() {
    return (
        <ul className="grid gap-4 sm:grid-cols-3">
            {CHANNELS.map(({ icon: Icon, name, body }) => (
                <li key={name}>
                    <Panel className="h-full">
                        <Icon className="h-6 w-6 text-primary" aria-hidden />
                        <h3 className="mt-4 text-[1.125rem] font-bold text-text">{name}</h3>
                        <p className="mt-1.5 text-body text-muted">{body}</p>
                    </Panel>
                </li>
            ))}
        </ul>
    );
}

/** The differentiator: nothing to set up. */
export function NoSetupBlock({ headingId }: { headingId: string }) {
    return (
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-16">
            <div>
                <SectionTitle
                    id={headingId}
                    eyebrow="No accounts. No keys."
                    title="You never touch a payment gateway."
                    sub="Taking payments and sending texts are the two steps that stop people. Other tools send you off to open an account somewhere and paste in a secret key. We just do it."
                />
                <CheckList items={NO_SETUP_POINTS} className="mt-8" />
            </div>
            <div>
                <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
                    <table className="w-full text-left text-[15px]">
                        <caption className="sr-only">What other tools ask you to do, and what Bookly does instead</caption>
                        <thead>
                            <tr className="text-small">
                                <th scope="col" className="w-1/2 px-4 py-3 font-semibold text-muted sm:px-5">Other tools ask you to</th>
                                <th scope="col" className="w-1/2 bg-primary px-4 py-3 font-semibold text-primary-fg sm:px-5">With Bookly</th>
                            </tr>
                        </thead>
                        <tbody>
                            {COMPARISON.map(([a, b]) => (
                                <tr key={a} className="border-t border-border align-top">
                                    <td className="px-4 py-3.5 text-muted sm:px-5">{a}</td>
                                    <td className="bg-primary-soft/60 px-4 py-3.5 font-semibold text-text sm:px-5">
                                        <span className="inline-flex items-start gap-2">
                                            <Check className="mt-1 h-4 w-4 text-primary" strokeWidth={3} aria-hidden />
                                            {b}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="mt-6 text-small font-medium text-muted">Works with</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                    {WORKS_WITH.map((w) => (
                        <li key={w} className="rounded-control border border-border bg-surface px-3 py-2 text-small text-text">{w}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

export function BusinessTypeCards({ exclude }: { exclude?: BusinessType['slug'] }) {
    const items = BUSINESS_TYPES.filter((b) => b.slug !== exclude);
    return (
        <ul className={cn('grid gap-4', items.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            {items.map((b) => (
                <li key={b.slug}>
                    <Link
                        href={b.path}
                        className={cn('group flex h-full flex-col rounded-card border border-border bg-surface p-6 shadow-card hover:shadow-card-hover', styles.lift)}
                    >
                        <h3 className="text-[1.125rem] font-bold text-text">{b.name}</h3>
                        <p className="mt-1.5 flex-1 text-body text-muted">{b.blurb}</p>
                        <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-semibold text-primary">
                            Bookly for {b.short.toLowerCase()}
                            <ArrowRight className="h-4 w-4 transition-transform duration-ui group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                        </span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/** Native <details> accordions: keyboard and screen-reader friendly with no JS. */
export function FaqList({ items }: { items: readonly QA[] }) {
    return (
        <div className="divide-y divide-border border-y border-border">
            {items.map(({ q, a }) => (
                <details key={q} className={cn('group', styles.faq)}>
                    <summary className="flex min-h-[56px] cursor-pointer items-center justify-between gap-6 py-4 text-[1.0625rem] font-semibold text-text">
                        {q}
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-primary" aria-hidden>
                            <Plus className={cn('h-4 w-4', styles.faqIcon)} />
                        </span>
                    </summary>
                    <p className="max-w-[65ch] pb-5 text-body text-muted">{a}</p>
                </details>
            ))}
        </div>
    );
}

/** Photo cards of the businesses Bookly is made for. Images are lazy and sized. */
export function IndustryCards() {
    return (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INDUSTRIES.map((b) => {
                const body = (
                    <>
                        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={`/images/marketing/${b.image}-640.webp`}
                                srcSet={`/images/marketing/${b.image}-640.webp 640w, /images/marketing/${b.image}-960.webp 960w`}
                                sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 92vw"
                                width={640}
                                height={478}
                                loading="lazy"
                                decoding="async"
                                alt={b.alt}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                            />
                        </div>
                        <div className="flex flex-1 flex-col p-5">
                            <h3 className="text-[1.0625rem] font-bold text-text">{b.name}</h3>
                            <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-muted">{b.blurb}</p>
                            {b.href && (
                                <span className="mt-3 inline-flex items-center gap-1.5 text-[15px] font-semibold text-primary">
                                    See how it works
                                    <ArrowRight className="h-4 w-4 transition-transform duration-ui group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                                </span>
                            )}
                        </div>
                    </>
                );
                const shell = 'group flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card';
                return (
                    <li key={b.name}>
                        {b.href ? (
                            <Link href={b.href} className={cn(shell, 'hover:shadow-card-hover', styles.lift)}>{body}</Link>
                        ) : (
                            <div className={shell}>{body}</div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
