import { describe, expect, it } from 'vitest';
import { buildAdminUpsert, parseCreateAdminArgs } from './admin-bootstrap.js';

const base = ['--email', 'Me@Example.com', '--name', 'Me'];

describe('parseCreateAdminArgs', () => {
    it('defaults to SUPPORT, never OWNER, and says the role was not chosen', () => {
        expect(parseCreateAdminArgs(base)).toMatchObject({ email: 'me@example.com', name: 'Me', role: 'SUPPORT', roleExplicit: false });
    });
    it('--super means OWNER (explicit)', () => {
        expect(parseCreateAdminArgs([...base, '--super'])).toMatchObject({ role: 'OWNER', roleExplicit: true });
    });
    it('--role picks any known role, case-insensitively', () => {
        for (const r of ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY']) {
            expect(parseCreateAdminArgs([...base, '--role', r.toLowerCase()])).toMatchObject({ role: r, roleExplicit: true });
        }
    });
    it('rejects an unknown role, and --super combined with a non-owner role', () => {
        expect(() => parseCreateAdminArgs([...base, '--role', 'ROOT'])).toThrow(/role/i);
        expect(() => parseCreateAdminArgs([...base, '--role'])).toThrow(/role/i);
        expect(() => parseCreateAdminArgs([...base, '--super', '--role', 'SUPPORT'])).toThrow(/super/i);
        expect(parseCreateAdminArgs([...base, '--super', '--role', 'OWNER']).role).toBe('OWNER');
    });
    it('requires a plausible email', () => {
        expect(() => parseCreateAdminArgs(['--name', 'x'])).toThrow(/email/i);
        expect(() => parseCreateAdminArgs(['--email', 'nope'])).toThrow(/email/i);
    });
    it('an explicit password must be at least 12 characters', () => {
        expect(() => parseCreateAdminArgs([...base, '--password', 'short'])).toThrow(/12/);
        expect(parseCreateAdminArgs([...base, '--password', 'long-enough-pw']).password).toBe('long-enough-pw');
    });
});

describe('buildAdminUpsert', () => {
    const hash = 'h';
    it('create ALWAYS writes the role and keeps the legacy flag in step', () => {
        const plain = buildAdminUpsert(parseCreateAdminArgs(base), hash);
        expect(plain.create).toMatchObject({ role: 'SUPPORT', isSuperAdmin: false, email: 'me@example.com', passwordHash: 'h' });
        const owner = buildAdminUpsert(parseCreateAdminArgs([...base, '--super']), hash);
        expect(owner.create).toMatchObject({ role: 'OWNER', isSuperAdmin: true });
    });
    it('update with --super (or --role) rewrites the role AND the flag on an existing admin', () => {
        expect(buildAdminUpsert(parseCreateAdminArgs([...base, '--super']), hash).update).toMatchObject({ role: 'OWNER', isSuperAdmin: true, isActive: true });
        expect(buildAdminUpsert(parseCreateAdminArgs([...base, '--role', 'finance']), hash).update).toMatchObject({ role: 'FINANCE', isSuperAdmin: false });
    });
    it('update WITHOUT a role flag is a password reset only: it never demotes an existing admin', () => {
        const u = buildAdminUpsert(parseCreateAdminArgs(base), hash).update;
        expect(u).not.toHaveProperty('role');
        expect(u).not.toHaveProperty('isSuperAdmin');
        expect(u).toMatchObject({ passwordHash: 'h', isActive: true });
    });
});
