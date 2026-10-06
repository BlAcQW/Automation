import { describe, it, expect } from 'vitest';
import {
    ADMIN_ROLES,
    ALL_PERMISSIONS,
    ROLE_PERMISSIONS,
    resolveAdminRole,
    authorizeAdmin,
    type AdminPermission,
} from './admin-permissions.js';

describe('resolveAdminRole', () => {
    it('uses the role column when it is valid', () => {
        for (const role of ADMIN_ROLES) expect(resolveAdminRole({ role, isSuperAdmin: false })).toBe(role);
    });
    it('the role beats the legacy flag: a SUPPORT row with isSuperAdmin stays SUPPORT', () => {
        expect(resolveAdminRole({ role: 'SUPPORT', isSuperAdmin: true })).toBe('SUPPORT');
    });
    it('falls back to the legacy flag only when role is missing', () => {
        expect(resolveAdminRole({ role: undefined, isSuperAdmin: true })).toBe('OWNER');
        expect(resolveAdminRole({ role: null, isSuperAdmin: true })).toBe('OWNER');
        expect(resolveAdminRole({ role: '', isSuperAdmin: false })).toBe('SUPPORT');
        expect(resolveAdminRole({})).toBe('SUPPORT');
    });
    it('an unknown role string fails closed to READONLY, never to the legacy flag', () => {
        expect(resolveAdminRole({ role: 'GOD', isSuperAdmin: true })).toBe('READONLY');
        expect(resolveAdminRole({ role: 'owner', isSuperAdmin: true })).toBe('READONLY');
    });
});

describe('role -> permission map', () => {
    const allow = (role: any, perm: AdminPermission, method = 'GET') => authorizeAdmin(role, perm, method).ok;

    it('OWNER holds every permission', () => {
        for (const p of ALL_PERMISSIONS) expect(allow('OWNER', p)).toBe(true);
    });

    it('FINANCE: money, billing views and payout switches; not tenants, support, flows or admin management', () => {
        for (const p of ['money:read', 'payouts:switch', 'promos:read', 'promos:write', 'audit:read'] as const) {
            expect(allow('FINANCE', p)).toBe(true);
        }
        for (const p of ['tenants:write', 'tenants:delete', 'support:access', 'outbound:switch', 'flows:write', 'admins:manage', 'conversations:handoff', 'platform:switch'] as const) {
            expect(allow('FINANCE', p)).toBe(false);
        }
    });

    it('FINANCE can pause platform-wide payouts but not platform-wide outbound', () => {
        expect(allow('FINANCE', 'payouts:platform_switch')).toBe(true);
        expect(allow('FINANCE', 'outbound:platform_switch')).toBe(false);
    });

    it('SUPPORT: tenants, conversations, alerts, support access, outbound switch; no money, no payout switch, no admin mgmt', () => {
        for (const p of ['tenants:read', 'tenants:write', 'users:read', 'alerts:read', 'alerts:write', 'support:access', 'conversations:handoff', 'outbound:switch', 'flows:read'] as const) {
            expect(allow('SUPPORT', p)).toBe(true);
        }
        for (const p of ['money:read', 'payouts:switch', 'payouts:platform_switch', 'admins:manage', 'tenants:delete', 'flows:write', 'promos:write'] as const) {
            expect(allow('SUPPORT', p)).toBe(false);
        }
    });

    it('READONLY holds read permissions only', () => {
        for (const [perm, ] of Object.entries(ROLE_PERMISSIONS)) void perm;
        const writes = ALL_PERMISSIONS.filter((p) => !p.endsWith(':read') && p !== 'self');
        for (const p of writes) expect(allow('READONLY', p)).toBe(false);
        for (const p of ['tenants:read', 'money:read', 'audit:read', 'alerts:read', 'flows:read', 'stats:read'] as const) {
            expect(allow('READONLY', p)).toBe(true);
        }
    });

    it('READONLY is GET only even for a read permission', () => {
        expect(authorizeAdmin('READONLY', 'tenants:read', 'POST').ok).toBe(false);
        expect(authorizeAdmin('READONLY', 'tenants:read', 'GET').ok).toBe(true);
        expect(authorizeAdmin('READONLY', 'tenants:read', 'HEAD').ok).toBe(true);
    });

    it('every role may use "self" (own password, own 2FA), including READONLY with non-GET', () => {
        for (const r of ADMIN_ROLES) expect(allow(r, 'self', 'POST')).toBe(true);
    });

    it('denial says why, for the 403 message', () => {
        expect(authorizeAdmin('SUPPORT', 'money:read', 'GET')).toEqual({ ok: false, reason: 'role_lacks_permission' });
        expect(authorizeAdmin('READONLY', 'alerts:write', 'POST')).toEqual({ ok: false, reason: 'role_lacks_permission' });
        expect(authorizeAdmin('READONLY', 'tenants:read', 'DELETE')).toEqual({ ok: false, reason: 'read_only_role' });
    });

    it('an unknown permission is denied for everyone but OWNER is not special-cased into it', () => {
        expect(authorizeAdmin('OWNER', 'nope' as any, 'GET').ok).toBe(false);
    });
});
