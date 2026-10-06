/**
 * Admin roles and what they may do (A4).
 *
 * Every admin route names ONE permission; `authorizeAdmin` decides from the
 * admin's role. The map below is the single place that answers "who can do
 * what", so changing a role's reach is a one-line, reviewable change.
 *
 *   OWNER     everything, including managing admins, deleting tenants, flows
 *             and the platform-wide switches.
 *   FINANCE   money oversight, billing terms, promo codes, per-tenant and
 *             platform payout switches, audit log, read-only tenant/messaging views.
 *   SUPPORT   tenants, users, conversations, alerts, support access, the
 *             per-tenant outbound switch, read-only flows. No money, no payout
 *             switches, no admin management.
 *   READONLY  GET requests for read permissions only. Nothing else, ever.
 *
 * `self` (own password, own 2FA, who am I) is open to every role: it touches
 * only the caller's own account.
 */

export const ADMIN_ROLES = ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ALL_PERMISSIONS = [
    'self',
    'stats:read',
    'attention:read',
    'alerts:read',
    'alerts:write',
    'tenants:read',
    'tenants:write',
    'tenants:delete',
    'users:read',
    'users:write',
    'bookings:read',
    'money:read',
    'messaging:read',
    'audit:read',
    'promos:read',
    'promos:write',
    'billing:read',
    'billing:write',
    'admins:manage',
    'support:access',
    'conversations:handoff',
    'outbound:switch',
    'payouts:switch',
    'payouts:platform_switch',
    'outbound:platform_switch',
    'platform:switch',
    'flows:read',
    'flows:write',
    'security:policy',
] as const;
export type AdminPermission = (typeof ALL_PERMISSIONS)[number];

const READ_ONLY_PERMISSIONS: readonly AdminPermission[] = [
    'self',
    'stats:read',
    'attention:read',
    'alerts:read',
    'tenants:read',
    'users:read',
    'bookings:read',
    'money:read',
    'messaging:read',
    'audit:read',
    'promos:read',
    'billing:read',
    'flows:read',
];

export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
    OWNER: new Set(ALL_PERMISSIONS),
    FINANCE: new Set<AdminPermission>([
        'self',
        'stats:read',
        'attention:read',
        'alerts:read',
        'tenants:read',
        'bookings:read',
        'money:read',
        'messaging:read',
        'audit:read',
        'promos:read',
        'promos:write',
        'billing:read',
        'billing:write',
        'payouts:switch',
        'payouts:platform_switch',
    ]),
    SUPPORT: new Set<AdminPermission>([
        'self',
        'stats:read',
        'attention:read',
        'alerts:read',
        'alerts:write',
        'tenants:read',
        'tenants:write',
        'users:read',
        'users:write',
        'bookings:read',
        'messaging:read',
        'audit:read',
        'billing:read',
        'support:access',
        'conversations:handoff',
        'outbound:switch',
        'flows:read',
    ]),
    READONLY: new Set<AdminPermission>(READ_ONLY_PERMISSIONS),
};

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Which role an admin row has. The `role` column wins. The legacy
 * `isSuperAdmin` flag is consulted ONLY when the role is missing (a row read
 * from before the migration, a partial object): super-admin -> OWNER, anyone
 * else -> SUPPORT (what a non-super admin could already do). A role string
 * we do not recognise fails CLOSED to READONLY, never up to the legacy flag.
 */
export function resolveAdminRole(row: { role?: string | null; isSuperAdmin?: boolean | null }): AdminRole {
    const role = row.role;
    if (role === undefined || role === null || role === '') return row.isSuperAdmin ? 'OWNER' : 'SUPPORT';
    return (ADMIN_ROLES as readonly string[]).includes(role) ? (role as AdminRole) : 'READONLY';
}

export type AuthorizeResult = { ok: true } | { ok: false; reason: 'role_lacks_permission' | 'read_only_role' };

export function authorizeAdmin(role: AdminRole, permission: AdminPermission, method: string): AuthorizeResult {
    if (!ROLE_PERMISSIONS[role]?.has(permission)) return { ok: false, reason: 'role_lacks_permission' };
    // READONLY is GET-only no matter what: `self` is the one exception, so a
    // read-only admin can still change their own password and enrol 2FA.
    if (role === 'READONLY' && permission !== 'self' && !READ_METHODS.has(method.toUpperCase())) {
        return { ok: false, reason: 'read_only_role' };
    }
    return { ok: true };
}

/** Does this role hold the permission (ignoring the HTTP method)? */
export function can(role: AdminRole, permission: AdminPermission): boolean {
    return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
