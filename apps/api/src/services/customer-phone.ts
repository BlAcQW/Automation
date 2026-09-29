/**
 * Normalising a phone number a customer typed into a chat.
 *
 * WhatsApp hands us the number for free. Instagram and Messenger do not — they
 * identify people by an opaque scoped id and never reveal a phone. But a
 * booking needs one: the Paystack deposit link is sent to it, and reminders on
 * those channels can only go out over SMS, because Meta allows no message at
 * all once the 24-hour window shuts.
 *
 * So the assistant has to ask, and whatever the customer types has to be turned
 * into something dialable. The rule that matters most here is the one about
 * refusing: a number we are not sure about must be rejected so the assistant
 * asks again, never guessed into a plausible-looking string that silently fails
 * to deliver on the morning of the appointment.
 */

/** Shortest and longest plausible E.164 subscriber lengths, digits only. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Pull the country calling code off a known-good E.164 number.
 *
 * Country codes are one to three digits with no way to tell them apart by
 * shape alone, so this uses the small set of one- and two-digit codes and
 * treats everything else as three. It is only ever applied to the business's
 * OWN number, which is already known good.
 */
const ONE_DIGIT_CC = new Set(['1', '7']);
const TWO_DIGIT_CC = new Set([
    '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44',
    '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58',
    '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91',
    '92', '93', '94', '95', '98',
]);

export function countryCodeFromE164(e164: string | null | undefined): string | null {
    if (!e164 || !e164.trim().startsWith('+')) return null;
    const digits = e164.replace(/\D/g, '');
    if (digits.length < 4) return null;

    if (ONE_DIGIT_CC.has(digits.slice(0, 1))) return digits.slice(0, 1);
    if (TWO_DIGIT_CC.has(digits.slice(0, 2))) return digits.slice(0, 2);
    return digits.slice(0, 3);
}

/**
 * Turn what a customer typed into an E.164 number, or null if we cannot be
 * confident.
 *
 * `businessNumber` is the tenant's own number in E.164, used only to work out
 * which country a local "0…" number belongs to. Without it a local number is
 * refused rather than assigned to a guessed country.
 */
export function normalizeCustomerPhone(
    input: string,
    businessNumber?: string | null,
): string | null {
    if (!input) return null;

    const trimmed = input.trim();
    const hadPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');

    if (!digits) return null;

    if (hadPlus) {
        if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
        return `+${digits}`;
    }

    // National form: a single trunk zero, then the subscriber number. Only
    // completable when we know what country the business is in.
    if (digits.startsWith('0')) {
        const cc = countryCodeFromE164(businessNumber);
        if (!cc) return null;
        const local = digits.replace(/^0+/, '');
        if (!local) return null;
        const full = `${cc}${local}`;
        if (full.length < MIN_DIGITS || full.length > MAX_DIGITS) return null;
        return `+${full}`;
    }

    // No plus and no trunk zero: treat as international if it is long enough
    // to be one, otherwise refuse.
    if (digits.length < MIN_DIGITS + 2 || digits.length > MAX_DIGITS) return null;
    return `+${digits}`;
}
