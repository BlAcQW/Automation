/**
 * The demo seed creates accounts with known passwords (an OWNER platform admin
 * among them). It must never run against production: refuse unless the
 * database is local and NODE_ENV is not production. SEED_ALLOW_REMOTE=true is
 * the deliberate override for a throwaway remote database.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function seedRefusal(env: { nodeEnv?: string; databaseUrl?: string; allowRemote?: string }): string | null {
    if (env.nodeEnv === 'production') return 'Refusing to seed: NODE_ENV is production.';
    if (!env.databaseUrl) return 'Refusing to seed: DATABASE_URL is not set.';
    let host: string;
    try {
        host = new URL(env.databaseUrl).hostname;
    } catch {
        return 'Refusing to seed: DATABASE_URL is not a valid URL.';
    }
    if (!LOCAL_HOSTS.has(host) && env.allowRemote !== 'true') {
        return `Refusing to seed: the database host (${host}) is not local. Set SEED_ALLOW_REMOTE=true only for a throwaway database.`;
    }
    return null;
}
