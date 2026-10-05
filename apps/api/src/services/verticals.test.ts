import { describe, it, expect } from 'vitest';
import { verticalDefaults, VERTICALS } from './verticals.js';

describe('verticalDefaults', () => {
    it('RIDES turns deposits off so hold-expiry cannot auto-cancel rides', () => {
        expect(verticalDefaults('RIDES')).toEqual({ depositRequired: false });
    });

    it('APPOINTMENTS changes nothing', () => {
        expect(verticalDefaults('APPOINTMENTS')).toEqual({});
    });

    it('returns a fresh object each call (no shared mutable state)', () => {
        const a = verticalDefaults('RIDES');
        (a as Record<string, unknown>).depositRequired = true;
        expect(verticalDefaults('RIDES')).toEqual({ depositRequired: false });
    });

    it('covers every vertical', () => {
        for (const v of VERTICALS) expect(verticalDefaults(v)).toBeTypeOf('object');
    });
});
