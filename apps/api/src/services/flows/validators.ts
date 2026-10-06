/** Answer validators for `ask` steps. Pure; return the normalised value. */

export type FieldResult = { ok: true; value: string } | { ok: false };

export interface FieldSpec {
    validate: 'name' | 'email' | 'phone' | 'studentId' | 'free';
    pattern?: string;
}

const MAX_FREE = 500;
const DEFAULT_STUDENT_ID = /^[A-Za-z0-9][A-Za-z0-9/_.-]{3,24}$/;
const NAME = /^\p{L}[\p{L}\p{M} '.-]*$/u;
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
/** Newlines/tabs become spaces, other control characters are dropped, runs of spaces collapse. */
function clean(input: string): string {
    return input
        .replace(/[\t\n\r]/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/ {2,}/g, ' ')
        .trim();
}

/** Longest answer a custom pattern is ever tested against. */
export const MAX_PATTERN_INPUT = 64;
export const MAX_PATTERN_LENGTH = 100;
/** Largest repetition bound in a pattern: `{n,m}` needs m <= this. */
const MAX_REPEAT = 64;
/**
 * Quantified atoms per pattern. Adjacent quantified atoms over overlapping
 * characters backtrack polynomially (degree = their count), so the count is
 * capped: 4 atoms over <=64 characters is at worst a few hundred thousand steps.
 */
const MAX_QUANTIFIED_ATOMS = 4;

const CLASS_ESCAPES = new Set(['d', 'D', 'w', 'W', 's', 'S']);
const META = new Set(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);

interface Seq { i: number; quantified: number; hasAlt: boolean }

/** Parses `{n}` / `{n,m}` / `?` at p[i]. Unbounded, lazy and stacked quantifiers are refused. */
function quantifierAt(p: string, i: number): { present: boolean; end: number } | null {
    const c = p[i];
    let end = i;
    if (c === '?') {
        end = i + 1;
    } else if (c === '{') {
        const m = /^\{(\d{1,2})(?:,(\d{1,2}))?\}/.exec(p.slice(i));
        if (!m) return null;
        const lo = Number(m[1]);
        const hi = m[2] === undefined ? lo : Number(m[2]);
        if (hi > MAX_REPEAT || lo > hi) return null;
        end = i + m[0].length;
    } else if (c === '*' || c === '+') {
        return null; // unbounded
    } else {
        return { present: false, end: i };
    }
    if (end < p.length && '?+*{'.includes(p[end])) return null; // lazy / possessive / stacked
    return { present: true, end };
}

/** One `[...]` set starting at p[i]. Returns the index after `]`, or -1. */
function classEnd(p: string, i: number): number {
    let j = i + 1;
    if (p[j] === '^') j++;
    const start = j;
    while (j < p.length && p[j] !== ']') {
        const c = p[j];
        if (c === '[') return -1;
        if (c === '\\') {
            const n = p[j + 1];
            if (n === undefined || !(CLASS_ESCAPES.has(n) || /[^A-Za-z0-9]/.test(n))) return -1;
            j += 2;
            continue;
        }
        if (p[j + 1] === '-' && p[j + 2] !== undefined && p[j + 2] !== ']') {
            const hi = p[j + 2];
            if (hi === '\\' || hi === '[' || c > hi) return -1;
            j += 3;
            continue;
        }
        j++;
    }
    return j < p.length && j > start ? j + 1 : -1;
}

function parseSeq(p: string, from: number, inGroup: boolean): Seq | null {
    let i = from;
    let quantified = 0;
    let hasAlt = false;
    const take = (end: number): boolean => {
        const q = quantifierAt(p, end);
        if (!q) return false;
        if (q.present) quantified++;
        i = q.end;
        return true;
    };
    while (i < p.length) {
        const c = p[i];
        if (c === ')') {
            if (inGroup) break;
            return null;
        }
        if (c === '|') { hasAlt = true; i++; continue; }
        if (c === '^') {
            if (i !== 0) return null; // only a leading anchor
            i++; continue;
        }
        if (c === '$') {
            if (inGroup || i !== p.length - 1) return null; // only a trailing anchor
            i++; continue;
        }
        if (c === '(') {
            if (inGroup) return null; // no nested groups
            let inner = i + 1;
            if (p[inner] === '?') {
                if (p.startsWith('(?:', i)) inner = i + 3;
                else return null; // lookaround, named group
            }
            const seq = parseSeq(p, inner, true);
            if (!seq || p[seq.i] !== ')') return null;
            const q = quantifierAt(p, seq.i + 1);
            if (!q) return null;
            // Quantifying a group is only safe when its body has nothing to backtrack into.
            if (q.present && (seq.quantified > 0 || seq.hasAlt)) return null;
            quantified += seq.quantified + (q.present ? 1 : 0);
            i = q.end;
            continue;
        }
        if (c === '[') {
            const end = classEnd(p, i);
            if (end < 0 || !take(end)) return null;
            continue;
        }
        if (c === '\\') {
            const n = p[i + 1];
            if (n === undefined || !(CLASS_ESCAPES.has(n) || /[^A-Za-z0-9]/.test(n))) return null; // no backrefs, \b, \p, \x ...
            if (!take(i + 2)) return null;
            continue;
        }
        if (c === '.') {
            if (!take(i + 1)) return null;
            continue;
        }
        if (META.has(c) || c < ' ') return null; // stray quantifier, brace or bracket
        if (!take(i + 1)) return null;
    }
    return { i, quantified, hasAlt };
}

/**
 * Whitelist check for tenant-authored `ask` patterns. Allowed: literals, `.`,
 * `\d \w \s` (and negations), escaped punctuation, `[...]` sets, `^`/`$` at the
 * ends, `(...)`/`(?:...)` groups (not nested), `|`, and the quantifiers `?`,
 * `{n}`, `{n,m}` with m <= 64. Refused: `*`, `+`, `{n,}`, lazy/possessive
 * quantifiers, nested quantifiers, a quantified group containing a quantifier or
 * an alternation (`(a|aa)+`), backreferences, lookaround, named groups, and more
 * than 4 quantified atoms. Together with MAX_PATTERN_INPUT this bounds matching
 * time; it is a whitelist, not an attempt to detect every bad regex.
 */
export function isSafePattern(pattern: string): boolean {
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return false;
    const seq = parseSeq(pattern, 0, false);
    if (!seq || seq.i !== pattern.length || seq.quantified > MAX_QUANTIFIED_ATOMS) return false;
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

/** Ghana-friendly: 0XXXXXXXXX and 233XXXXXXXXX become +233XXXXXXXXX; otherwise E.164. */
export function normalizePhone(input: string): string | null {
    const compact = input.replace(/[\s\-().]/g, '');
    if (!/^\+?\d+$/.test(compact)) return null;
    if (compact.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
    if (/^0\d{9}$/.test(compact)) return `+233${compact.slice(1)}`;
    if (/^233\d{9}$/.test(compact)) return `+${compact}`;
    return null;
}

export function validateField(spec: FieldSpec, raw: string): FieldResult {
    const value = clean(raw);
    if (value.length === 0) return { ok: false };
    switch (spec.validate) {
        case 'name':
            return value.length >= 2 && value.length <= 60 && NAME.test(value) ? { ok: true, value } : { ok: false };
        case 'email':
            return value.length <= 254 && EMAIL.test(value) ? { ok: true, value: value.toLowerCase() } : { ok: false };
        case 'phone': {
            const phone = normalizePhone(value);
            return phone ? { ok: true, value: phone } : { ok: false };
        }
        case 'studentId': {
            if (value.length > MAX_PATTERN_INPUT) return { ok: false };
            let re = DEFAULT_STUDENT_ID;
            if (spec.pattern) {
                if (!isSafePattern(spec.pattern)) return { ok: false };
                re = new RegExp(spec.pattern);
            }
            return re.test(value) ? { ok: true, value } : { ok: false };
        }
        case 'free':
            return value.length <= MAX_FREE ? { ok: true, value } : { ok: false };
    }
}
