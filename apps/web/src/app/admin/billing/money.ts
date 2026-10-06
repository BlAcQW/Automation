/**
 * Major-unit text <-> integer minor units, with string maths only (no floats),
 * so 0.1 + 0.2 style drift cannot reach a price. The API validates again.
 */

const MAJOR_RE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** "12.5" -> 1250, "0.05" -> 5, "" / "-1" / "1.234" / "abc" -> null. */
export function parseMajorToMinor(input: string): number | null {
    const m = MAJOR_RE.exec(input.trim());
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

/** 1250 -> "12.50". Integer minor units in, string out. */
export function formatMinor(minor: number): string {
    const whole = Math.trunc(minor / 100);
    return `${whole}.${String(minor - whole * 100).padStart(2, '0')}`;
}
