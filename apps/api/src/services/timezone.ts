/**
 * Wall-clock ↔ UTC conversion for a tenant's timezone.
 *
 * A booking is made in the *business's* local time: "Tuesday 2pm" means 2pm in
 * Accra, not 2pm wherever the server happens to run. Building the Date with
 * `new Date('2026-09-20T14:00:00')` parses in server-local time, so the same
 * code produces a different instant depending on the host — and the tenant's
 * stored `timezone` was never consulted at all.
 *
 * Implemented with Intl rather than a date library: Node ships the full IANA
 * database, so this handles DST transitions correctly with no dependency.
 */

/**
 * How far `timeZone` is ahead of UTC at a given instant, in milliseconds.
 * Positive east of Greenwich. Accounts for DST because it is evaluated at that
 * specific instant, not as a fixed rule.
 */
function offsetAt(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(instant);

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // `hour` comes back as 24 at midnight under hour12:false in some ICU builds.
    const hour = get('hour') % 24;

    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return asIfUtc - instant.getTime();
}

/**
 * Turn a wall-clock date + time in `timeZone` into the correct UTC instant.
 *
 * @param dateStr YYYY-MM-DD
 * @param timeStr HH:MM (24-hour)
 * @returns the Date to store, or null if the input isn't a valid date/time
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null;

    // Read the wall clock as though it were UTC, then subtract the zone's
    // offset. Evaluating the offset at the guess is accurate except within a
    // DST transition, which the second pass below resolves.
    const guess = new Date(`${dateStr}T${timeStr}:00Z`);
    if (Number.isNaN(guess.getTime())) return null;

    const firstPass = new Date(guess.getTime() - offsetAt(guess, timeZone));
    const corrected = new Date(guess.getTime() - offsetAt(firstPass, timeZone));
    return corrected;
}

/** Midnight in `timeZone` for a YYYY-MM-DD date, as a UTC instant. */
export function startOfDayInZone(dateStr: string, timeZone: string): Date | null {
    return zonedTimeToUtc(dateStr, '00:00', timeZone);
}

/** The YYYY-MM-DD date that `instant` falls on, in `timeZone`. */
export function zonedDateString(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

/** HH:MM that `instant` shows as in `timeZone`. */
export function zonedTimeString(instant: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`;
}

/** Fall back to UTC for an unset or unrecognised zone rather than throwing. */
export function safeZone(timeZone: string | null | undefined): string {
    if (!timeZone) return 'UTC';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return timeZone;
    } catch {
        return 'UTC';
    }
}
