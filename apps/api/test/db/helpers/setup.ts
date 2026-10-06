/**
 * Per-test-file setup: re-check the guard in this worker, then give every test
 * an empty database (TRUNCATE ... CASCADE on every table except
 * _prisma_migrations) and close the connections at the end of the file.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { assertSafeEnv } from './guard.js';
import { closeDb, truncateAll } from './db.js';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

beforeAll(() => {
    assertSafeEnv(API_DIR);
});

beforeEach(async () => {
    assertSafeEnv(API_DIR);
    await truncateAll();
});

afterAll(async () => {
    await closeDb();
});
