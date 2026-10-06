import { describe, it, expect } from 'vitest';
import { seedRefusal } from './seed-guard.js';

const local = 'postgresql://u:p@localhost:5432/bookly';

describe('seedRefusal (demo seed creates known-password accounts)', () => {
    it('allows a local development database', () => {
        expect(seedRefusal({ nodeEnv: 'development', databaseUrl: local })).toBeNull();
        expect(seedRefusal({ nodeEnv: undefined, databaseUrl: 'postgresql://u:p@127.0.0.1/x' })).toBeNull();
    });

    it('refuses NODE_ENV=production even on localhost', () => {
        expect(seedRefusal({ nodeEnv: 'production', databaseUrl: local })).toMatch(/production/);
    });

    it('refuses a remote database (e.g. Supabase) unless explicitly allowed', () => {
        const remote = 'postgresql://u:p@db.abc.supabase.co:5432/postgres';
        expect(seedRefusal({ nodeEnv: 'development', databaseUrl: remote })).toMatch(/not local/);
        expect(seedRefusal({ nodeEnv: 'development', databaseUrl: remote, allowRemote: 'true' })).toBeNull();
    });

    it('refuses a missing or unparseable URL', () => {
        expect(seedRefusal({ nodeEnv: 'development', databaseUrl: undefined })).not.toBeNull();
        expect(seedRefusal({ nodeEnv: 'development', databaseUrl: 'not a url' })).not.toBeNull();
    });
});
