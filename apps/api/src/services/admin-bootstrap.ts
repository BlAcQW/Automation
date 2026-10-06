/**
 * Argument handling for `npm run admin:create` (scripts/create-admin.ts),
 * kept here so it can be unit tested.
 *
 * Least privilege: a plain admin is SUPPORT, never OWNER. The Admin.role column
 * has a default as well (READONLY, see the admin_role_default migration), but
 * the script never relies on it: it always writes the role on create.
 */
import { ADMIN_ROLES, type AdminRole } from './admin-permissions.js';

export const MIN_ADMIN_PASSWORD = 12;
export const DEFAULT_BOOTSTRAP_ROLE: AdminRole = 'SUPPORT';

export interface CreateAdminArgs {
    email: string;
    name: string;
    password?: string;
    role: AdminRole;
    /** True when --role or --super was given. Only then is an existing admin's role changed. */
    roleExplicit: boolean;
}

function valueOf(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
}

export function parseCreateAdminArgs(argv: string[]): CreateAdminArgs {
    const email = valueOf(argv, 'email')?.trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('--email you@example.com is required');
    const name = valueOf(argv, 'name') ?? 'Platform Admin';
    const password = valueOf(argv, 'password');
    if (password !== undefined && password.length < MIN_ADMIN_PASSWORD) {
        throw new Error(`--password must be at least ${MIN_ADMIN_PASSWORD} characters (or omit it to generate one)`);
    }

    const wantsSuper = argv.includes('--super');
    const roleFlagPresent = argv.includes('--role');
    const rawRole = valueOf(argv, 'role')?.trim().toUpperCase();
    if (roleFlagPresent && (!rawRole || !(ADMIN_ROLES as readonly string[]).includes(rawRole))) {
        throw new Error(`--role must be one of ${ADMIN_ROLES.join(', ')}`);
    }
    if (wantsSuper && rawRole && rawRole !== 'OWNER') {
        throw new Error('--super means OWNER; it cannot be combined with another --role');
    }

    const role: AdminRole = wantsSuper ? 'OWNER' : ((rawRole as AdminRole | undefined) ?? DEFAULT_BOOTSTRAP_ROLE);
    return { email, name, ...(password !== undefined ? { password } : {}), role, roleExplicit: wantsSuper || roleFlagPresent };
}

/**
 * Prisma upsert pieces. `create` always carries the role. `update` carries it
 * only when it was asked for, so re-running the script to reset an owner's
 * password cannot quietly demote them; with --super/--role it rewrites the role
 * and the legacy isSuperAdmin flag together.
 */
export function buildAdminUpsert(args: CreateAdminArgs, passwordHash: string) {
    const isSuperAdmin = args.role === 'OWNER';
    return {
        where: { email: args.email },
        create: { email: args.email, passwordHash, name: args.name, role: args.role, isSuperAdmin },
        update: {
            passwordHash,
            name: args.name,
            isActive: true,
            ...(args.roleExplicit ? { role: args.role, isSuperAdmin } : {}),
        },
    };
}
