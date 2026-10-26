import { describe, it, expect } from 'vitest';
import {
    formatCedi,
    parseCedi,
    normalizeGhanaPhone,
    formatGhanaPhone,
    formatGhanaPhoneInput,
    isValidGhanaPhone,
} from './format';

describe('formatCedi', () => {
    it('formats with the GH₵ symbol, thousands separators and two decimals', () => {
        expect(formatCedi(1250)).toBe('GH₵ 1,250.00');
        expect(formatCedi(0)).toBe('GH₵ 0.00');
        expect(formatCedi(12.5)).toBe('GH₵ 12.50');
    });
    it('puts the sign before the symbol for negatives', () => {
        expect(formatCedi(-50)).toBe('-GH₵ 50.00');
    });
    it('converts from pesewas when asked', () => {
        expect(formatCedi(12550, { fromPesewas: true })).toBe('GH₵ 125.50');
    });
    it('drops .00 on whole amounts in compact mode only', () => {
        expect(formatCedi(1250, { compact: true })).toBe('GH₵ 1,250');
        expect(formatCedi(1250.5, { compact: true })).toBe('GH₵ 1,250.50');
    });
    it('accepts numeric strings and renders a dash for non-numbers', () => {
        expect(formatCedi('99.9')).toBe('GH₵ 99.90');
        expect(formatCedi(Number.NaN)).toBe('—');
        expect(formatCedi(null)).toBe('—');
        expect(formatCedi(undefined)).toBe('—');
    });
});

describe('parseCedi', () => {
    it('reads typed amounts with commas, symbol or spaces', () => {
        expect(parseCedi('1,250.50')).toBe(1250.5);
        expect(parseCedi('GH₵ 20')).toBe(20);
        expect(parseCedi(' 7.5 ')).toBe(7.5);
    });
    it('returns null for empty or invalid input', () => {
        expect(parseCedi('')).toBeNull();
        expect(parseCedi('abc')).toBeNull();
        expect(parseCedi('1.2.3')).toBeNull();
    });
});

describe('Ghana phone numbers', () => {
    it('normalises every common way of typing a number to E.164', () => {
        expect(normalizeGhanaPhone('0244123456')).toBe('+233244123456');
        expect(normalizeGhanaPhone('244123456')).toBe('+233244123456');
        expect(normalizeGhanaPhone('+233 24 412 3456')).toBe('+233244123456');
        expect(normalizeGhanaPhone('233244123456')).toBe('+233244123456');
        expect(normalizeGhanaPhone('+2330244123456')).toBe('+233244123456');
        expect(normalizeGhanaPhone('024-412-3456')).toBe('+233244123456');
    });
    it('rejects numbers that are too short, too long or not Ghanaian', () => {
        expect(normalizeGhanaPhone('02441234')).toBeNull();
        expect(normalizeGhanaPhone('02441234567')).toBeNull();
        expect(normalizeGhanaPhone('+447700900123')).toBeNull();
        expect(normalizeGhanaPhone('')).toBeNull();
        expect(isValidGhanaPhone('0244123456')).toBe(true);
        expect(isValidGhanaPhone('0144123456')).toBe(false);
    });
    it('formats for display', () => {
        expect(formatGhanaPhone('+233244123456')).toBe('+233 24 412 3456');
        expect(formatGhanaPhone('0244123456')).toBe('+233 24 412 3456');
        expect(formatGhanaPhone('not a phone')).toBe('not a phone');
    });
    it('groups partial input as the user types (national part, no leading 0)', () => {
        expect(formatGhanaPhoneInput('0')).toBe('');
        expect(formatGhanaPhoneInput('02')).toBe('2');
        expect(formatGhanaPhoneInput('024')).toBe('24');
        expect(formatGhanaPhoneInput('02441')).toBe('24 41');
        expect(formatGhanaPhoneInput('0244123456')).toBe('24 412 3456');
        expect(formatGhanaPhoneInput('+233244123456789')).toBe('24 412 3456');
    });
});
