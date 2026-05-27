/**
 * Pricing tiers displayed on the public landing page.
 *
 * MIRRORS `apps/api/src/services/plans.ts` — keep these in sync. The single
 * source of truth at runtime is the API (`GET /billing/status` returns the
 * authoritative tier), so when you change prices, update plans.ts AND this
 * file. The marketing CTA flow doesn't have an authenticated context, so
 * we can't fetch from the API at build time without extra plumbing.
 *
 * Currency note: today everything is USD. The GHS migration (see Part 7 of
 * the historical plan) updates this constant + plans.ts together.
 */

export type PlanId = 'free' | 'starter' | 'pro';

export interface DisplayPlan {
    id: PlanId;
    name: string;
    price: number;
    currency: string;
    /** "/mo" or "/forever" etc. — appended after the price. */
    period: string;
    /** A one-line positioning statement under the price. */
    tagline: string;
    /** Customer-facing bullet list. */
    features: string[];
    /** CTA label and link target. */
    ctaLabel: string;
    ctaHref: string;
    /** Whether to give this card the featured emerald border + glow. */
    featured?: boolean;
}

export const PRICING: DisplayPlan[] = [
    {
        id: 'free',
        name: 'Free',
        price: 0,
        currency: 'USD',
        period: '/forever',
        tagline: 'Try Bookly with a small workload.',
        features: [
            '50 outbound WhatsApp messages / month',
            '1 WhatsApp number',
            'Up to 3 services',
            'Up to 3 message templates',
            '1 staff seat',
        ],
        ctaLabel: 'Start free',
        ctaHref: '/register',
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 49,
        currency: 'USD',
        period: '/mo',
        tagline: 'The full Bookly experience for serious operators.',
        features: [
            '5,000 outbound messages / month',
            'Unlimited services, staff & templates',
            'Custom branding',
            'Bot + human takeover',
            'Calendar sync + automated reminders',
            'Priority support',
        ],
        ctaLabel: 'Start 14-day free trial',
        ctaHref: '/register',
        featured: true,
    },
    {
        id: 'starter',
        name: 'Starter',
        price: 19,
        currency: 'USD',
        period: '/mo',
        tagline: 'For small businesses ready to scale beyond Free.',
        features: [
            '500 outbound messages / month',
            'Unlimited services & templates',
            'Up to 3 staff seats',
            'Bot + human takeover',
            'Calendar sync',
        ],
        ctaLabel: 'Start with Starter',
        ctaHref: '/register',
    },
];

/** Format a price as `$49` or `$0` (no decimal shown when whole). */
export function formatPrice(plan: DisplayPlan): string {
    const symbol = plan.currency === 'USD' ? '$' : plan.currency === 'GHS' ? '₵' : plan.currency + ' ';
    return `${symbol}${plan.price}`;
}
