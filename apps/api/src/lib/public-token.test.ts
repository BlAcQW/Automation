import { describe, it, expect } from 'vitest';
import { generatePublicToken } from './public-token.js';

describe('generatePublicToken', () => {
    it('produces a 16-char URL-safe string', () => {
        const token = generatePublicToken();
        expect(token).toHaveLength(16);
        // base64url alphabet only — no +, /, or = padding.
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces unique tokens across many calls', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 1000; i++) seen.add(generatePublicToken());
        expect(seen.size).toBe(1000);
    });
});
