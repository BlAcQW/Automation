import { describe, it, expect } from 'vitest';
import { cn } from './cn';
import preset from './tailwind-preset';

describe('cn', () => {
    it('merges conflicting tailwind classes, last wins', () => {
        expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    });
    it('drops falsy values', () => {
        expect(cn('a', false, null, undefined, 0 as unknown as string, 'b')).toBe('a b');
    });
    it('lets accent tokens be overridden by app classes', () => {
        expect(cn('bg-accent-500', 'bg-accent-400')).toBe('bg-accent-400');
    });
});

describe('tailwind preset accent scale', () => {
    const colors = (preset.theme!.extend as any).colors;
    it('maps every step to a CSS variable triplet with alpha support', () => {
        for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
            expect(colors.accent[step]).toBe(`rgb(var(--accent-${step}-rgb) / <alpha-value>)`);
        }
        expect(colors.accent.alt).toContain('--accent-alt-rgb');
    });
    it('contains no hardcoded brand colour', () => {
        expect(JSON.stringify(colors.accent)).not.toMatch(/#[0-9a-f]{3,6}/i);
    });
});
