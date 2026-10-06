/**
 * The safety guard: the DB suite may only ever run against the throwaway
 * database scripts/test-db.sh created. Pure functions, so the refusals are
 * themselves tested (guard.dbtest.ts) without a database.
 *
 * Four independent checks, all of which must pass:
 *   1. host is loopback and the database name is `bookly_test_<12 hex>`;
 *   2. the URL does not match any DATABASE_URL found in the app's .env files
 *      or already present in the caller's environment under another name;
 *   3. DATABASE_URL (what the app code reads) equals BOOKLY_TEST_DB_URL (what
 *      the script generated);
 *   4. the live database carries the one-time marker the script set with
 *      `ALTER DATABASE ... SET bookly.throwaway = '<token>'` (checked in
 *      global-setup, over a real connection). A production database cannot
 *      have it.
 */
import fs from 'node:fs';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DB_NAME_RE = /^bookly_test_[0-9a-f]{12}$/;

export class UnsafeTestDatabaseError extends Error {
    constructor(reason: string) {
        super(`REFUSING TO RUN THE DB TESTS: ${reason}. Use apps/api/scripts/test-db.sh, which starts a throwaway database.`);
        this.name = 'UnsafeTestDatabaseError';
    }
}

interface Parsed { host: string; port: string; db: string; }

function parse(url: string): Parsed | null {
    try {
        const u = new URL(url);
        if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') return null;
        return { host: u.hostname.toLowerCase(), port: u.port || '5432', db: decodeURIComponent(u.pathname.replace(/^\//, '')) };
    } catch {
        return null;
    }
}

/** DATABASE_URL values found in the .env files the real app would load. */
export function collectForbiddenUrls(apiDir: string): string[] {
    const files = [
        path.resolve(apiDir, '.env'),
        path.resolve(apiDir, '../../.env'),
        path.resolve(apiDir, 'prisma/.env'),
        process.env.DOTENV_CONFIG_PATH ?? '',
    ].filter(Boolean);
    const out: string[] = [];
    for (const f of files) {
        let text: string;
        try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
        for (const line of text.split(/\r?\n/)) {
            const m = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL)\s*=\s*(.*)$/.exec(line);
            if (!m) continue;
            const value = m[2].trim().replace(/^['"]|['"]$/g, '');
            if (value) out.push(value);
        }
    }
    return out;
}

export interface GuardInput {
    databaseUrl: string | undefined;
    testDbUrl: string | undefined;
    token: string | undefined;
    forbiddenUrls: string[];
}

/** Throws UnsafeTestDatabaseError unless the URL is provably the throwaway one. */
export function assertSafeTestUrl(input: GuardInput): void {
    const { databaseUrl, testDbUrl, token, forbiddenUrls } = input;
    if (!testDbUrl || !token) throw new UnsafeTestDatabaseError('BOOKLY_TEST_DB_URL / BOOKLY_TEST_DB_TOKEN are not set (not launched by test-db.sh)');
    if (!databaseUrl || databaseUrl !== testDbUrl) throw new UnsafeTestDatabaseError('DATABASE_URL differs from the URL test-db.sh generated');
    const p = parse(testDbUrl);
    if (!p) throw new UnsafeTestDatabaseError('the database URL is not a postgres URL');
    if (!LOOPBACK.has(p.host)) throw new UnsafeTestDatabaseError(`host "${p.host}" is not loopback`);
    if (!DB_NAME_RE.test(p.db)) throw new UnsafeTestDatabaseError(`database name "${p.db}" is not a throwaway name`);
    for (const f of forbiddenUrls) {
        const fp = parse(f);
        if (f === testDbUrl || (fp && fp.host === p.host && fp.port === p.port && fp.db === p.db)) {
            throw new UnsafeTestDatabaseError('the URL matches a DATABASE_URL from the app .env');
        }
    }
}

export function assertMarker(actual: string | null | undefined, expected: string): void {
    if (!actual || actual !== expected) {
        throw new UnsafeTestDatabaseError('the database does not carry this run\'s throwaway marker');
    }
}

/** Env-only checks, usable from every worker. */
export function assertSafeEnv(apiDir: string): void {
    assertSafeTestUrl({
        databaseUrl: process.env.DATABASE_URL,
        testDbUrl: process.env.BOOKLY_TEST_DB_URL,
        token: process.env.BOOKLY_TEST_DB_TOKEN,
        forbiddenUrls: collectForbiddenUrls(apiDir),
    });
}
