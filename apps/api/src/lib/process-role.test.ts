import { describe, it, expect } from 'vitest';
import { resolveProcessRole, assertRoleRequirements, runsHttp, runsBackground } from './process-role.js';

describe('resolveProcessRole', () => {
    it.each([undefined, '', '   '])('defaults to "all" for %j', (raw) => {
        expect(resolveProcessRole(raw)).toBe('all');
    });

    it.each(['api', 'worker', 'all'])('accepts %s', (raw) => {
        expect(resolveProcessRole(raw)).toBe(raw);
    });

    it('is case- and whitespace-insensitive', () => {
        expect(resolveProcessRole(' Worker ')).toBe('worker');
    });

    it('rejects an unknown role instead of silently running everything', () => {
        expect(() => resolveProcessRole('workers')).toThrow(/PROCESS_ROLE.*api.*worker.*all/);
    });
});

describe('runsHttp / runsBackground', () => {
    it('maps each role to what it runs', () => {
        expect([runsHttp('api'), runsBackground('api')]).toEqual([true, false]);
        expect([runsHttp('worker'), runsBackground('worker')]).toEqual([false, true]);
        expect([runsHttp('all'), runsBackground('all')]).toEqual([true, true]);
    });
});

describe('assertRoleRequirements', () => {
    it('allows "all" without Redis (single-process fallback)', () => {
        expect(() => assertRoleRequirements('all', undefined)).not.toThrow();
    });

    it.each(['api', 'worker'] as const)('requires REDIS_URL for split role %s', (role) => {
        expect(() => assertRoleRequirements(role, undefined)).toThrow(/REDIS_URL/);
        expect(() => assertRoleRequirements(role, '')).toThrow(/REDIS_URL/);
    });

    it('passes split roles when Redis is configured', () => {
        expect(() => assertRoleRequirements('api', 'redis://localhost:6379')).not.toThrow();
        expect(() => assertRoleRequirements('worker', 'redis://localhost:6379')).not.toThrow();
    });
});
