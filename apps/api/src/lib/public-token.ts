import { randomBytes } from 'node:crypto';

/**
 * Generate a non-guessable token for public, no-login customer links
 * (order tracking, appointment cancel).
 *
 * 12 random bytes → 16 URL-safe base64 characters, 96 bits of entropy.
 * Short enough to keep an SMS link inside a single 160-char segment,
 * long enough that tokens cannot be enumerated or guessed.
 */
export function generatePublicToken(): string {
    return randomBytes(12).toString('base64url');
}
