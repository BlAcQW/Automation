import { describe, it, expect } from 'vitest';
import { parseReviewerArgs, reviewerPassword, reviewerNotes } from './reviewer-account.js';

describe('Meta reviewer account helper', () => {
    it('parses --api and --email, defaulting the names', () => {
        expect(parseReviewerArgs(['node', 's', '--api', 'https://api.bookly.example', '--email', 'meta-review@bookly.example'])).toEqual({
            api: 'https://api.bookly.example', email: 'meta-review@bookly.example', name: 'Meta Reviewer', businessName: 'Review Salon',
        });
    });
    it('keeps an API path prefix (production serves the API under /api)', () => {
        expect(parseReviewerArgs(['node', 's', '--api', 'https://bookly.ikieguy.online/api/', '--email', 'a@b.co']).api).toBe('https://bookly.ikieguy.online/api');
    });
    it('refuses a non-https API (except localhost) and a missing email', () => {
        expect(() => parseReviewerArgs(['node', 's', '--api', 'http://api.bookly.example', '--email', 'a@b.co'])).toThrow(/https/);
        expect(parseReviewerArgs(['node', 's', '--api', 'http://localhost:3001', '--email', 'a@b.co']).api).toBe('http://localhost:3001');
        expect(() => parseReviewerArgs(['node', 's', '--api', 'https://x.example'])).toThrow(/--email/);
    });
    it('makes a strong password with letters, digits and a symbol', () => {
        const p = reviewerPassword();
        expect(p.length).toBeGreaterThanOrEqual(16);
        expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/\d/); expect(p).toMatch(/[^A-Za-z0-9]/);
        expect(reviewerPassword()).not.toBe(p);
    });
    it('writes reviewer notes that name the login and the steps', () => {
        const n = reviewerNotes({ web: 'https://bookly.example', email: 'r@x.co', password: 'Pw' });
        expect(n).toContain('https://bookly.example/login');
        expect(n).toContain('r@x.co');
        expect(n).toMatch(/Channels/);
        expect(n).toMatch(/Facebook Messenger/); expect(n).toMatch(/Connect/);
    });
});
