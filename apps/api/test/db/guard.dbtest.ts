import { describe, expect, it } from 'vitest';
import { assertMarker, assertSafeTestUrl, collectForbiddenUrls, UnsafeTestDatabaseError } from './helpers/guard.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GOOD = 'postgresql://postgres:pw@127.0.0.1:55001/bookly_test_0123456789ab?connection_limit=40';
const base = { databaseUrl: GOOD, testDbUrl: GOOD, token: 'tok', forbiddenUrls: [] as string[] };

describe('safety guard', () => {
    it('accepts the throwaway URL the script generates', () => {
        expect(() => assertSafeTestUrl(base)).not.toThrow();
    });
    it.each([
        ['missing token', { ...base, token: undefined }],
        ['missing test url', { ...base, testDbUrl: undefined }],
        ['DATABASE_URL differs from the generated URL', { ...base, databaseUrl: GOOD.replace('55001', '55002') }],
        ['remote host', (() => { const u = 'postgresql://p:x@db.owljuplahkyadmiekymd.supabase.co:5432/bookly_test_0123456789ab'; return { ...base, databaseUrl: u, testDbUrl: u }; })()],
        ['non-throwaway database name', (() => { const u = 'postgresql://p:x@127.0.0.1:5432/postgres'; return { ...base, databaseUrl: u, testDbUrl: u }; })()],
        ['not a postgres url', { ...base, databaseUrl: 'mysql://x', testDbUrl: 'mysql://x' }],
        ['garbage', { ...base, databaseUrl: 'not a url', testDbUrl: 'not a url' }],
        ['matches the app .env', { ...base, forbiddenUrls: [GOOD] }],
        ['matches the app .env by host/port/db', { ...base, forbiddenUrls: ['postgresql://other:creds@127.0.0.1:55001/bookly_test_0123456789ab'] }],
    ])('refuses: %s', (_name, input) => {
        expect(() => assertSafeTestUrl(input as any)).toThrow(UnsafeTestDatabaseError);
    });
    it('refuses a database without this run\'s marker', () => {
        expect(() => assertMarker(null, 'tok')).toThrow(UnsafeTestDatabaseError);
        expect(() => assertMarker('other', 'tok')).toThrow(UnsafeTestDatabaseError);
        expect(() => assertMarker('tok', 'tok')).not.toThrow();
    });
    it('reads DATABASE_URL values out of .env files, quoted or not', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
        fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'a', 'b', '.env'), 'FOO=1\nDATABASE_URL="postgresql://u:p@h:5432/d"\nexport DIRECT_URL=postgresql://u:p@h2:5432/d2\n');
        expect(collectForbiddenUrls(path.join(dir, 'a', 'b'))).toEqual(['postgresql://u:p@h:5432/d', 'postgresql://u:p@h2:5432/d2']);
    });
    it('the real repo .env (if any) is picked up as forbidden', () => {
        const apiDir = path.resolve(__dirname, '../..');
        const forbidden = collectForbiddenUrls(apiDir);
        for (const f of forbidden) expect(f).not.toBe(process.env.BOOKLY_TEST_DB_URL);
    });
});
