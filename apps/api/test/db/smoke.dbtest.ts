import { describe, expect, it } from 'vitest';
import { rawPrisma } from './helpers/db.js';
import { seedTenant } from './helpers/seed.js';

describe('harness smoke', () => {
    it('talks to the throwaway database and starts each test empty', async () => {
        expect(await rawPrisma().tenant.count()).toBe(0);
        await seedTenant();
        expect(await rawPrisma().tenant.count()).toBe(1);
    });
    it('was truncated between tests', async () => {
        expect(await rawPrisma().tenant.count()).toBe(0);
    });
});
