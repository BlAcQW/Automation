/**
 * Which half of the platform this process runs.
 *
 *   all     HTTP + background work in one process (default; today's deployment)
 *   api     HTTP only. Background work is left to a `worker` process.
 *   worker  Background work only (queue workers, sweepers, purges). No listener.
 *
 * Split mode (`api` / `worker`) REQUIRES Redis. Without it the only way work
 * reaches a worker is an in-process `setImmediate` inside the API, so a split
 * deployment would silently do the work in the wrong process (or never). We
 * refuse to boot rather than guess; run `all` if there is no Redis.
 */

export type ProcessRole = 'api' | 'worker' | 'all';

const ROLES: readonly ProcessRole[] = ['api', 'worker', 'all'];

export function resolveProcessRole(raw: string | undefined): ProcessRole {
    const value = (raw ?? '').trim().toLowerCase();
    if (value === '') return 'all';
    if ((ROLES as readonly string[]).includes(value)) return value as ProcessRole;
    throw new Error(`Invalid PROCESS_ROLE "${raw}". Expected one of: api, worker, all.`);
}

export function runsHttp(role: ProcessRole): boolean {
    return role === 'api' || role === 'all';
}

export function runsBackground(role: ProcessRole): boolean {
    return role === 'worker' || role === 'all';
}

export function assertRoleRequirements(role: ProcessRole, redisUrl: string | undefined): void {
    if (role === 'all') return;
    if (!redisUrl) {
        throw new Error(
            `PROCESS_ROLE=${role} requires REDIS_URL: the api and worker processes hand work to each other ` +
            'through Redis queues. Set REDIS_URL, or run a single process with PROCESS_ROLE=all.',
        );
    }
}
