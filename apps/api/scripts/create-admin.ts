/**
 * Create (or reset the password of) a platform admin.
 *
 *   npm run admin:create -w apps/api -- --email you@example.com --name "Your Name" [--password ...] [--role OWNER|FINANCE|SUPPORT|READONLY | --super]
 *
 * Role: --role picks one; --super is shorthand for --role OWNER. With neither, a NEW admin
 * is SUPPORT (least privilege, never OWNER) and an EXISTING admin keeps their role. With
 * --super/--role an existing admin's role is rewritten too.
 *
 * Omit --password to have a strong one generated and printed once.
 * Needs DATABASE_URL in the environment (source the root .env first).
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { buildAdminUpsert, parseCreateAdminArgs, type CreateAdminArgs } from '../src/services/admin-bootstrap.js';

const USAGE = 'Usage: --email you@example.com --name "Your Name" [--password ...] [--role OWNER|FINANCE|SUPPORT|READONLY | --super]';

let args: CreateAdminArgs;
try {
    args = parseCreateAdminArgs(process.argv);
} catch (err) {
    console.error((err as Error).message);
    console.error(USAGE);
    process.exit(1);
}

let password = args.password;
let generated = false;
if (!password) {
    // 16 chars from an unambiguous alphabet.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(16);
    password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    generated = true;
}

async function main(): Promise<void> {
    const prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(password as string, 12);
    const admin = await prisma.admin.upsert({
        ...buildAdminUpsert(args, passwordHash),
        select: { id: true, email: true, role: true },
    });
    await prisma.$disconnect();

    console.log(`Admin ready: ${admin.email} (role: ${admin.role})`);
    if (!args.roleExplicit) {
        console.log('No --role/--super given: new admins are SUPPORT; an existing admin keeps their current role.');
    }
    if (generated) {
        console.log(`Temporary password (shown once, change it after signing in): ${password}`);
    }
    console.log('Sign in at /admin/login');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
