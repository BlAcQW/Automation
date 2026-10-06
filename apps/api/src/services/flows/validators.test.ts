import { describe, expect, it } from 'vitest';
import { MAX_PATTERN_INPUT, isSafePattern, validateField } from './validators.js';
import { turboSampleFlow as turboFlow } from './samples/turbo-flow.js';

describe('isSafePattern: accepted (conservative whitelist)', () => {
    it.each([
        '^\\d{8}$', '^\\d{8,10}$', '^[A-Z]{2}\\d{6}$', '^[A-Za-z0-9/_.-]{4,25}$', '^\\d{3}-\\d{4}$', '^[a-z]{1,10}$',
        '^(?:ab){2}$', '^(ab){1,3}$', '^(ab|cd)$', '^(?:UG|PG)\\d{7}$', '^[^\\s]{3,12}$', '^\\w{3,20}$',
        '^\\d{2}\\/\\d{2}$', '^.{1,10}$', '^[A-Z]\\d?$', 'abc', '^TU-\\d{4,6}$', '^\\d{1,2}\\.\\d{1,2}$',
    ])('%s', (p) => expect(isSafePattern(p)).toBe(true));

    it('every pattern used by the shipped sample flows', () => {
        const patterns: string[] = [];
        for (const s of Object.values((turboFlow as any).states ?? {})) if ((s as any).pattern) patterns.push((s as any).pattern);
        expect(patterns.length).toBeGreaterThan(0);
        for (const p of patterns) expect(isSafePattern(p), p).toBe(true);
    });
});

describe('isSafePattern: rejected', () => {
    it.each([
        // catastrophic backtracking
        '^(a|aa)+$', '^(\\d|\\d\\d)+$', '^(a+)+$', '^(a*)*$', '^(a|a)*$', '^(\\d+)+$', '^(.*a){20}$',
        // nested quantified groups, alternation inside a quantified group (even bounded)
        '^(\\d{1,2}){1,5}$', '^(a|aa){1,20}$', '^((ab)+)+$', '^(ab(cd){2}){2}$',
        // unbounded quantifiers
        '^\\d+$', '^\\d*$', '^.*$', '^\\d{3,}$', '^[a-z]+$',
        // bounds too large, reversed, lazy/possessive/double quantifier
        '^\\d{1,65}$', '^\\d{5,2}$', '^\\d{1,2}?$', '^\\d??$', '^\\d{2}{3}$', '^a??$',
        // too many quantified atoms (polynomial blow-up)
        '^\\d?\\d?\\d?\\d?\\d?\\d?\\d?\\d?$', '^a{0,9}a{0,9}a{0,9}a{0,9}a{0,9}$',
        // backrefs, lookaround, named groups, unicode/escape extras, flags-like
        '^(a)\\1$', '^(?=a)a$', '^(?!a)b$', '^(?<=a)b$', '^(?<n>a)$', '^\\p{L}$', '^\\k<n>$', '^\\bfoo\\b$', '^\\x41$', '^\\u0041$',
        // syntax errors / stray metacharacters
        '([', '^[a-$', '^[]$', '^a)$', '^(a$', '^{3}$', '^*a$', '^[z-a]$', '^[[a]]$', '^a{$', '^a}$', '',
        // anchors in the wrong place
        'a^b', 'a$b', '^^a$',
        // length cap
        `^${'a'.repeat(100)}$`,
    ])('%s', (p) => expect(isSafePattern(p)).toBe(false));
});

describe('studentId validation with a custom pattern', () => {
    it('uses the pattern and still normalises control characters', () => {
        expect(validateField({ validate: 'studentId', pattern: '^\\d{8}$' }, '12345678')).toEqual({ ok: true, value: '12345678' });
        expect(validateField({ validate: 'studentId', pattern: '^\\d{8}$' }, '1234567').ok).toBe(false);
    });

    it('fails closed for an unsafe pattern instead of running it', () => {
        expect(validateField({ validate: 'studentId', pattern: '^(a|aa)+$' }, 'a'.repeat(40) + 'b').ok).toBe(false);
    });

    it('caps the input length before testing the pattern', () => {
        expect(MAX_PATTERN_INPUT).toBe(64);
        const spec = { validate: 'studentId' as const, pattern: '^[a-z]{1,64}$' };
        expect(validateField(spec, 'a'.repeat(64)).ok).toBe(true);
        expect(validateField(spec, 'a'.repeat(65)).ok).toBe(false);
        // the default pattern path obeys the same cap
        expect(validateField({ validate: 'studentId' }, 'A'.repeat(65)).ok).toBe(false);
    });

    it('every accepted pattern stays fast on adversarial input', () => {
        const worst = 'a'.repeat(MAX_PATTERN_INPUT - 1) + '!';
        for (const pattern of ['^[a-z]{1,64}$', '^(ab){1,3}$', '^\\w{3,20}\\d{1,5}$', '^[a-z]{0,20}[a-z]{0,20}[a-z]{0,20}[a-z]{0,20}$']) {
            expect(isSafePattern(pattern), pattern).toBe(true);
            const start = performance.now();
            validateField({ validate: 'studentId', pattern }, worst);
            expect(performance.now() - start, pattern).toBeLessThan(100);
        }
    });
});
