import { describe, it, expect } from 'vitest';
import { parseCorsOrigins } from './index.js';

describe('parseCorsOrigins', () => {
    it('returns [] for undefined, empty and whitespace', () => {
        expect(parseCorsOrigins(undefined)).toEqual([]);
        expect(parseCorsOrigins('')).toEqual([]);
        expect(parseCorsOrigins('  , ,')).toEqual([]);
    });
    it('splits, trims and keeps http(s) origins with ports', () => {
        expect(parseCorsOrigins(' https://a.example.com , http://localhost:5173,https://b.io:8443 ')).toEqual([
            'https://a.example.com', 'http://localhost:5173', 'https://b.io:8443',
        ]);
    });
    it('de-duplicates', () => {
        expect(parseCorsOrigins('https://a.com,https://a.com')).toEqual(['https://a.com']);
    });
    it('rejects the wildcard (credentials are used)', () => {
        expect(() => parseCorsOrigins('*')).toThrow(/wildcard|\*/i);
        expect(() => parseCorsOrigins('https://a.com,*')).toThrow();
        expect(() => parseCorsOrigins('https://*.a.com')).toThrow();
    });
    it('rejects paths, trailing slashes, queries, fragments and userinfo', () => {
        for (const bad of ['https://a.com/', 'https://a.com/app', 'https://a.com?x=1', 'https://a.com#f', 'https://u:p@a.com']) {
            expect(() => parseCorsOrigins(bad), bad).toThrow(/origin/i);
        }
    });
    it('rejects non-http(s), relative and malformed entries', () => {
        for (const bad of ['ftp://a.com', 'javascript:alert(1)', 'a.com', '//a.com', 'null', 'https://']) {
            expect(() => parseCorsOrigins(bad), bad).toThrow();
        }
    });
    it('names the offending entry in the error', () => {
        expect(() => parseCorsOrigins('https://ok.com,nope')).toThrow(/nope/);
    });
});
