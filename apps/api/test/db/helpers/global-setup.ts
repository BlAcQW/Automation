import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { assertMarker, assertSafeEnv } from './guard.js';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Runs once, in the vitest main process, before any test file. */
export default async function setup(): Promise<void> {
    assertSafeEnv(API_DIR);
    const client = new PrismaClient({ datasources: { db: { url: process.env.BOOKLY_TEST_DB_URL! } } });
    try {
        const rows = await client.$queryRaw<Array<{ marker: string | null }>>`SELECT current_setting('bookly.throwaway', true) AS marker`;
        assertMarker(rows[0]?.marker, process.env.BOOKLY_TEST_DB_TOKEN!);
        const migrations = await client.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
        if (Number(migrations[0]?.n ?? 0) === 0) throw new Error('no migrations applied to the throwaway database');
    } finally {
        await client.$disconnect();
    }
}
