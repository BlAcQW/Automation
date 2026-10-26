/**
 * Ghana-first formatting helpers: cedi money and +233 phone numbers.
 * Pure functions — safe on the server and the client.
 */

export const CEDI_SYMBOL = 'GH₵';
export const GHANA_DIAL_CODE = '+233';

export interface FormatCediOptions {
    /** The amount is in pesewas (1/100 cedi), as many APIs store money. */
    fromPesewas?: boolean;
    /** Drop `.00` on whole amounts (`GH₵ 1,250`). Prices in lists, not ledgers. */
    compact?: boolean;
}

/** Locale number with a fixed count of decimals. (`format` is a bound getter on Intl.NumberFormat.) */
function cediDigits(value: number, digits: number): string {
    const { format: toText } = new Intl.NumberFormat('en-GH', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
    return toText(value);
}

/** `1250` → `GH₵ 1,250.00`. Non-numbers render as an em dash. */
export function formatCedi(
    amount: number | string | null | undefined,
    { fromPesewas = false, compact = false }: FormatCediOptions = {},
): string {
    if (amount === null || amount === undefined || amount === '') return '—';
    const raw = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(raw)) return '—';
    const cedis = fromPesewas ? raw / 100 : raw;
    const isWhole = Math.round(cedis * 100) % 100 === 0;
    const body = cediDigits(Math.abs(cedis), compact && isWhole ? 0 : 2);
    return (cedis < 0 ? '-' : '') + CEDI_SYMBOL + ' ' + body;
}

/** Reads a typed amount (`"GH₵ 1,250.50"`) as a number of cedis, or null. */
export function parseCedi(input: string): number | null {
    const cleaned = input.replace(/GH₵|GHS|₵/gi, '').replace(/[\s,]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
}

/** Strips everything but digits and reduces to the national number (no leading 0). */
function nationalDigits(input: string): string {
    let digits = input.replace(/\D/g, '');
    if (digits.startsWith('233')) digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1);
    return digits;
}

const GHANA_NATIONAL = /^[235]\d{8}$/;

/** Any common spelling of a Ghana number → `+233XXXXXXXXX`, or null if invalid. */
export function normalizeGhanaPhone(input: string): string | null {
    if (!input) return null;
    const compactInput = input.replace(/\s/g, '');
    // A foreign international number (+44…) is not Ghanaian.
    if (compactInput.startsWith('+') && !compactInput.startsWith(GHANA_DIAL_CODE)) return null;
    const national = nationalDigits(compactInput);
    return GHANA_NATIONAL.test(national) ? GHANA_DIAL_CODE + national : null;
}

export function isValidGhanaPhone(input: string): boolean {
    return normalizeGhanaPhone(input) !== null;
}

function groupNational(national: string): string {
    return [national.slice(0, 2), national.slice(2, 5), national.slice(5, 9)]
        .filter(Boolean)
        .join(' ');
}

/** `+233244123456` → `+233 24 412 3456`. Unparseable input is returned unchanged. */
export function formatGhanaPhone(input: string): string {
    const e164 = normalizeGhanaPhone(input);
    if (!e164) return input;
    return GHANA_DIAL_CODE + ' ' + groupNational(e164.slice(4));
}

/**
 * As-you-type grouping for the national part shown after a fixed `+233`
 * prefix: `0244123` → `24 412 3`. Caps at 9 digits.
 */
export function formatGhanaPhoneInput(input: string): string {
    return groupNational(nationalDigits(input).slice(0, 9));
}
