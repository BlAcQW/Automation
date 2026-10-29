/**
 * Plausible custom events (conversion goals set up in the Plausible dashboard).
 *
 * `track()` is safe to call anywhere: it does nothing on the server, nothing
 * when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is unset (script not loaded), and nothing
 * when an ad blocker removed the script. Plausible is cookieless, so no
 * consent banner is involved.
 *
 * Most call sites don't call it directly: put `data-analytics="Signup"` (or
 * another event) on a link and <AnalyticsEvents/> in the root layout reports
 * the click. Every wa.me link is reported as `WhatsApp Click` automatically.
 */

export type AnalyticsEvent = 'Signup' | 'Demo Request' | 'WhatsApp Click' | 'Waitlist';

/**
 * `Waitlist` is reported by the /waitlist form itself once a join succeeds
 * (not on a click), so it counts real sign-ups to the list. Add it as a
 * custom-event goal in Plausible.
 */
export const ANALYTICS_EVENTS: readonly AnalyticsEvent[] = ['Signup', 'Demo Request', 'WhatsApp Click', 'Waitlist'];

type PlausibleFn = (event: string, options?: { props?: Record<string, string> }) => void;

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
    return typeof value === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

export function track(event: AnalyticsEvent, props?: Record<string, string>): void {
    if (typeof window === 'undefined') return;
    const plausible = (window as unknown as { plausible?: PlausibleFn }).plausible;
    if (typeof plausible !== 'function') return;
    try {
        plausible(event, props ? { props } : undefined);
    } catch {
        // Analytics must never break a click.
    }
}

/** True for any WhatsApp click-to-chat link (wa.me or api.whatsapp.com). */
export function isWhatsAppHref(href: string | null | undefined): boolean {
    if (!href) return false;
    return /^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href);
}
