/**
 * Helpers for scripts/create-reviewer-account.ts: the Bookly login Meta's App
 * Review team uses. The account is made through the public sign-up endpoint
 * (the same validated path as a real business), with nothing connected, so
 * the reviewer can run Channels → Connect with their own Facebook account.
 */
import { randomBytes, randomInt } from 'node:crypto';

export interface ReviewerArgs {
    api: string;
    email: string;
    name: string;
    businessName: string;
}

function flag(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
}

export function parseReviewerArgs(argv: string[]): ReviewerArgs {
    const api = flag(argv, 'api');
    const email = flag(argv, 'email');
    if (!api) throw new Error('--api <Bookly API URL> is required');
    if (!email) throw new Error('--email <address for the reviewer login> is required');
    const url = new URL(api);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) throw new Error('--api must be https (only localhost may use http)');
    return {
        // Keep the path: the API may live under one (https://bookly.example/api).
        api: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
        email,
        name: flag(argv, 'name') ?? 'Meta Reviewer',
        businessName: flag(argv, 'business') ?? 'Review Salon',
    };
}

/** 18 characters: always at least one lower, upper, digit and symbol. */
export function reviewerPassword(): string {
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#%*-_';
    const all = lower + upper + digits + symbols;
    const pick = (set: string) => set[randomInt(set.length)];
    const chars = [pick(lower), pick(upper), pick(digits), pick(symbols), ...Array.from(randomBytes(14), (b) => all[b % all.length])];
    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

/** Text for the "Notes for reviewer" box in the App Review submission. */
export function reviewerNotes(a: { web: string; email: string; password: string }): string {
    return [
        'Test account for Bookly (a booking assistant for small businesses):',
        `  Sign in: ${a.web}/login`,
        `  Email:    ${a.email}`,
        `  Password: ${a.password}`,
        '',
        'Steps:',
        '  1. Sign in and open "Channels" in the left menu.',
        '  2. On the "Instagram" (or "Facebook Messenger") card, click Connect and approve the permissions with your test Facebook account.',
        '  3. Pick the Page; its linked Instagram professional account is connected with it, so both cards show Connected.',
        '  4. From a different account, send a message to that Page on Messenger or to the Instagram account.',
        '  5. The assistant replies within a few seconds; the conversation appears under "Conversations".',
        '',
        'Nothing is connected on this account beforehand. It can be disconnected again from Channels.',
    ].join('\n');
}
