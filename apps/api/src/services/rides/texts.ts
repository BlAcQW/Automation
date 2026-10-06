/**
 * Customer-facing ride messages, in TURBO's own wording (docs/turbo/USER-FLOW.md).
 * Plain functions so the flow, the notifications and the tests share one copy.
 */
import { formatMinor } from './geo.js';

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** "5 Dec 2026" in the given zone (UTC if the zone is unknown). */
export function formatDate(d: Date, timeZone: string): string {
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat('en-GB', { ...DATE_OPTS, timeZone });
    } catch {
        fmt = new Intl.DateTimeFormat('en-GB', { ...DATE_OPTS, timeZone: 'UTC' });
    }
    return fmt.formatToParts(d).map((p) => p.value).join('');
}

export function rides(n: number): string {
    return `${n} ${n === 1 ? 'ride' : 'rides'}`;
}

export function packageActivatedText(a: { name: string | null; rides: number; days: number; maxKm: number; balance: number }): string {
    const name = (a.name ?? '').trim().toUpperCase() || 'TURBER';
    return [
        `🎉 WELCOME TO TURBO, ${name}!`,
        "You're officially one of our Founding 50.",
        `🎟️ Your Package\n\n${rides(a.rides)}\nValid for ${a.days} days\n0–${a.maxKm} km`,
        `Balance: ${rides(a.balance)}`,
        'You now have priority access to TURBO rides.',
        'Reply BOOK to book a ride, or MENU for all options.',
    ].join('\n\n');
}

export function driverAssignedText(d: { name: string; vehicle: string; plate: string }): string {
    return `🚗 Driver Assigned\n\nDriver: ${d.name}\nVehicle: ${d.vehicle}\nPlate: ${d.plate}\n\nYour driver is on the way.`;
}

export function rideCompletedText(remaining: number | null): string {
    const balance = remaining === null ? '' : `1 ride used\n\n🎟️ Remaining balance: ${rides(Math.max(0, remaining))}\n\n`;
    return `✅ Ride Completed\n\nThanks for riding with TURBO.\n\n${balance}Need another ride?\nReply BOOK.`;
}

export const PAYG_PAYMENT_RECEIVED_TEXT = "✅ Payment Received\n\nYour ride is confirmed.\n\nWe're assigning your driver now.";

export const RIDE_REQUEST_RECEIVED_TEXT = "✅ Ride Request Received\n\nWe're finding your TURBO driver.\n\nPlease stay available.";

export function rideCancelledText(a: { ref: string; paidPayg: boolean }): string {
    const refund = a.paidPayg ? '\n\nYour payment will be refunded by the TURBO team.' : '';
    return `❌ Your TURBO ride ${a.ref} was cancelled.${refund}\n\nNeed another ride?\nReply BOOK.`;
}

export function packageNotActivatedText(reason: string): string {
    const why = reason === 'has_active'
        ? 'You already have an active TURBO package.'
        : 'All Founding Packages were taken before your payment came through.';
    return `⚠️ We received your payment, but your package was not activated.\n\n${why}\n\nThe TURBO team will contact you about a refund.`;
}

export function paygNotConfirmedText(): string {
    return "⚠️ We received your payment, but today's PAYG slots were already filled, so your ride is not booked.\n\nThe TURBO team will contact you about a refund.";
}

export function expiryReminderText(a: { expiresAt: Date; remaining: number; timeZone: string }): string {
    return `⏳ Your TURBO package expires on ${formatDate(a.expiresAt, a.timeZone)}.\n\nYou have ${rides(a.remaining)} left. Unused rides expire with the package.\n\nReply BOOK to book a ride.`;
}

export function lowBalanceText(a: { remaining: number; expiresAt: Date | null; timeZone: string }): string {
    const exp = a.expiresAt ? `\nExpiry: ${formatDate(a.expiresAt, a.timeZone)}` : '';
    return `🎟️ Only ${rides(a.remaining)} left on your TURBO package.${exp}\n\nReply BOOK to book a ride.`;
}

/**
 * Customer-typed text (name, place labels) reaches the driver from TURBO's own
 * sender ID, so links and anything link-shaped are removed and each part is
 * kept short: an SMS must not become a way to phish drivers or run up cost.
 */
function smsSafe(text: string, max: number): string {
    const cleaned = text
        .replace(/\b(?:https?:\/\/|www\.)\S*/gi, '')
        .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|info|biz|io|co|gh|me|app|link|ly|xyz|online|site|top|club|shop|live|example)\b(?:\/\S*)?/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned || '-';
}

export function driverSmsText(a: { ref: string; customerName: string | null; customerPhone: string; pickup: string; destination: string; kind: 'PACKAGE' | 'PAYG' }): string {
    const name = a.customerName ? smsSafe(a.customerName, 30) : '';
    const who = name && name !== '-' ? `${name} (${a.customerPhone})` : a.customerPhone;
    return `TURBO ride ${a.ref} (${a.kind === 'PAYG' ? 'PAYG' : 'Package'}): pick up ${who} at ${smsSafe(a.pickup, 50)}, to ${smsSafe(a.destination, 50)}.`;
}

/** "GHS 960", "GHS 25.50" */
export function money(minor: number, currency: string): string {
    return `${currency} ${formatMinor(minor).replace(/\.00$/, '')}`;
}
