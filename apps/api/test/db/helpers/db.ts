/**
 * The two clients the suite talks to.
 *
 *   rawPrisma  plain PrismaClient: no tenant guard. Used for seeding and for
 *              reading back state, so a verification read can never be blocked
 *              by (or hide a bug behind) the guard.
 *   prisma     the REAL extended client, obtained by registering the app's own
 *              plugins/prisma.ts on a Fastify instance. That is the exact
 *              `$extends` guard production runs, including its mode
 *              resolution, not a copy of it.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import prismaPlugin, { type ExtendedPrismaClient } from '../../../src/plugins/prisma.js';
import { assertSafeEnv } from './guard.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let raw: PrismaClient | undefined;
let app: FastifyInstance | undefined;
let appReady: Promise<FastifyInstance> | undefined;

export function rawPrisma(): PrismaClient {
    assertSafeEnv(API_DIR);
    raw ??= new PrismaClient({ datasources: { db: { url: process.env.BOOKLY_TEST_DB_URL! } } });
    return raw;
}

/** A Fastify instance with the real prisma plugin registered (and nothing else). */
export async function getApp(): Promise<FastifyInstance> {
    assertSafeEnv(API_DIR);
    appReady ??= (async () => {
        const f = Fastify({ logger: false });
        await f.register(prismaPlugin);
        await f.ready();
        app = f;
        return f;
    })();
    return appReady;
}

/** The real extended (tenant-guarded) client. */
export async function guardedPrisma(): Promise<ExtendedPrismaClient> {
    return (await getApp()).prisma;
}

export async function closeDb(): Promise<void> {
    if (app) await app.close();
    if (raw) await raw.$disconnect();
    app = undefined;
    raw = undefined;
    appReady = undefined;
}

let tableList: string | undefined;

export async function truncateAll(): Promise<void> {
    const db = rawPrisma();
    if (!tableList) {
        const rows = await db.$queryRaw<Array<{ tablename: string }>>`
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
        tableList = rows.map((r) => `"${r.tablename}"`).join(', ');
    }
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}
