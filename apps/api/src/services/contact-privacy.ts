/**
 * Masking customer contact details from staff.
 *
 * WHY
 * ---
 * A tenant's customer list is the most valuable thing in their account, and
 * staff turnover in this market is high. A STAFF member with the dashboard
 * open can today read and copy every customer's phone number — the whole book
 * walks out of the door with them.
 *
 * So contacts are masked for staff by default. The name is never masked: staff
 * need it to do the job, and it is not a channel you can be messaged on.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 * ---------------------------------------
 * 1. Masking happens on the SERVER, before the value leaves the API. Masking in
 *    the browser would leave the real number sitting in the network response.
 * 2. It fails CLOSED. An unrecognised role is masked, not trusted.
 *
 * Staff who genuinely need a number use the audited reveal endpoint, which is
 * rate limited. Masked-by-default plus a logged, throttled reveal is what stops
 * bulk harvesting; a hard block would simply be worked around with a photo of
 * the screen.
 */

const BULLET = '•';

/** Digits of a phone number left visible at the end. */
const PHONE_TAIL = 4;

/**
 * Mask a phone number, keeping only the last few digits (and a leading `+`).
 *
 * Formatting is stripped before counting so that "+233 24 123 4567" and
 * "+233241234567" mask identically — otherwise the mask leaks more digits for
 * prettily formatted numbers.
 */
export function maskPhone(phone: string): string {
    if (!phone) return '';
    const hasPlus = phone.trim().startsWith('+');
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';

    const prefix = hasPlus ? '+' : '';
    if (digits.length <= PHONE_TAIL) {
        return prefix + BULLET.repeat(digits.length);
    }
    const tail = digits.slice(-PHONE_TAIL);
    return prefix + BULLET.repeat(digits.length - PHONE_TAIL) + tail;
}

/**
 * Mask a social handle, keeping the first two characters and the last one —
 * enough for a staff member to tell two customers apart, not enough to find
 * the account.
 */
export function maskHandle(handle: string): string {
    if (!handle) return '';
    const at = handle.startsWith('@');
    const body = at ? handle.slice(1) : handle;
    if (!body) return handle;

    const prefix = at ? '@' : '';
    if (body.length <= 3) {
        return prefix + body.slice(0, 1) + BULLET.repeat(Math.max(0, body.length - 1));
    }
    return prefix + body.slice(0, 2) + BULLET.repeat(body.length - 3) + body.slice(-1);
}

/**
 * Mask an email, keeping the first character and the whole domain. The domain
 * aids recognition ("the gmail one") without yielding a usable address.
 */
export function maskEmail(email: string): string {
    if (!email) return '';
    const at = email.lastIndexOf('@');
    if (at <= 0) return maskHandle(email);

    const local = email.slice(0, at);
    const domain = email.slice(at);
    if (local.length <= 1) return BULLET.repeat(local.length || 1) + domain;
    return local.slice(0, 1) + BULLET.repeat(local.length - 1) + domain;
}

/**
 * Should this viewer see masked contacts?
 *
 * The owner is never masked — it is their customer list. Everyone else is
 * masked when the tenant has the setting on, and an unknown role is treated as
 * untrusted rather than waved through.
 */
export function shouldMaskContacts(role: string | undefined, tenantMaskEnabled: boolean): boolean {
    if (role === 'OWNER') return false;
    return tenantMaskEnabled;
}

/** Contact-bearing fields this module knows how to mask. */
export interface MaskableContact {
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerHandle?: string | null;
    [key: string]: unknown;
}

/**
 * Return a copy of `record` with its contact fields masked.
 *
 * Immutable by design — callers map over query results, and mutating a Prisma
 * row in place invites the unmasked value being read again downstream.
 * `contactMasked: true` is included so clients can render a reveal affordance
 * instead of guessing from the bullets.
 */
export function maskContact<T extends MaskableContact>(record: T, mask: boolean): T {
    if (!mask) return record;

    const out: MaskableContact = { ...record, contactMasked: true };
    if (typeof record.customerPhone === 'string' && record.customerPhone) {
        out.customerPhone = maskPhone(record.customerPhone);
    }
    if (typeof record.customerEmail === 'string' && record.customerEmail) {
        out.customerEmail = maskEmail(record.customerEmail);
    }
    if (typeof record.customerHandle === 'string' && record.customerHandle) {
        out.customerHandle = maskHandle(record.customerHandle);
    }
    return out as T;
}

/** Convenience for list endpoints. */
export function maskContacts<T extends MaskableContact>(records: T[], mask: boolean): T[] {
    return mask ? records.map((r) => maskContact(r, true)) : records;
}
