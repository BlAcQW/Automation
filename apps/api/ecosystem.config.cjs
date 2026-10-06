/**
 * pm2 config for the SPLIT deployment: HTTP in one process, background work in
 * another. NOT APPLIED. Today `bookly-api` runs everything in one process
 * (`bash -c "node dist/index.js"`, PROCESS_ROLE unset = all) and keeps working
 * unchanged.
 *
 * Cut-over (see docs/PROCESS-ROLES.md):
 *   1. cd apps/api && npm run build
 *   2. pm2 delete bookly-api            # stop the all-in-one process
 *   3. pm2 start ecosystem.config.cjs   # starts bookly-api (HTTP) + bookly-worker
 *   4. pm2 save
 * Rollback: pm2 delete bookly-api bookly-worker, then start the old
 * `bash -c "node dist/index.js"` entry again (role defaults to all).
 *
 * Split mode REQUIRES REDIS_URL (set in apps/api/.env or the repo-root .env,
 * which config/index.ts already loads). Both processes refuse to boot without
 * it. Run exactly ONE bookly-worker unless you have read the sweeper notes in
 * docs/PROCESS-ROLES.md. bookly-api must stay a single fork (WebSocket
 * fan-out is per-process memory).
 */
const cwd = __dirname;

module.exports = {
    apps: [
        {
            name: 'bookly-api',
            cwd,
            script: 'dist/index.js',
            exec_mode: 'fork',
            instances: 1,
            env: { NODE_ENV: 'production', PROCESS_ROLE: 'api' },
            // Let in-flight requests finish.
            kill_timeout: 30000,
        },
        {
            name: 'bookly-worker',
            cwd,
            script: 'dist/worker.js',
            exec_mode: 'fork',
            instances: 1,
            env: { NODE_ENV: 'production', PROCESS_ROLE: 'worker' },
            // Must exceed the worker's 25s graceful-shutdown budget so BullMQ
            // can finish in-flight jobs before pm2 sends SIGKILL.
            kill_timeout: 30000,
        },
    ],
};
