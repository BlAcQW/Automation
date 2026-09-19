/**
 * Create (or reset the password of) a platform admin.
 *
 *   npm run admin:create -w apps/api -- --email you@example.com --name "Your Name" [--password ...] [--super]
 *
 * Omit --password to have a strong one generated and printed once.
 * Needs DATABASE_URL in the environment (source the root .env first).
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email')?.toLowerCase();
const name = arg('name') ?? 'Platform Admin';
const isSuperAdmin = process.argv.includes('--super');
let password = arg('password');

if (!email || !email.includes('@')) {
    console.error('Usage: --email you@example.com --name "Your Name" [--password ...] [--super]');
    process.exit(1);
}

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
        where: { email },
        update: { passwordHash, name, isActive: true, ...(isSuperAdmin ? { isSuperAdmin: true } : {}) },
        create: { email: email as string, passwordHash, name, isSuperAdmin },
        select: { id: true, email: true, isSuperAdmin: true },
    });
    await prisma.$disconnect();

    console.log(`Admin ready: ${admin.email} (super admin: ${admin.isSuperAdmin})`);
    if (generated) {
        console.log(`Temporary password (shown once, change it after signing in): ${password}`);
    }
    console.log('Sign in at /admin/login');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
