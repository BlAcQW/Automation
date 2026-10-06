/**
 * Vitest config for the REAL-DATABASE suite. Not used by `vitest run` / `npm
 * test`: those use vitest defaults, whose include glob (*.test.ts / *.spec.ts)
 * does not match the `*.dbtest.ts` files below, so the fast suite never
 * touches a database.
 *
 * Run through scripts/test-db.sh, which provisions the throwaway Postgres and
 * the env this config relies on. Running it by hand without that env is
 * refused by the global setup.
 *
 * Serial on purpose: one database, one test at a time, tables truncated
 * between tests. Concurrency is exercised INSIDE a test (Promise.all on the
 * real pool), which is the thing under test; parallel files would only add
 * cross-test noise and force a schema-per-worker migration step for no gain.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/db/**/*.dbtest.ts'],
        globalSetup: ['test/db/helpers/global-setup.ts'],
        setupFiles: ['test/db/helpers/setup.ts'],
        fileParallelism: false,
        pool: 'forks',
        poolOptions: { forks: { singleFork: true } },
        sequence: { concurrent: false },
        testTimeout: 60_000,
        hookTimeout: 60_000,
        env: {
            NODE_ENV: 'test',
            // So refund paths see a configured platform account. The Paystack client itself is mocked in those tests.
            BOOKINGFLOW_PAYSTACK_SECRET_KEY: 'sk_test_dbsuite_not_a_real_key',
        },
    },
});
