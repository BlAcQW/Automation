# Process roles: API and background work

`PROCESS_ROLE` decides what one Node process runs.

| Role | Runs | Needs Redis |
|---|---|---|
| `all` (default) | HTTP + all background work | no |
| `api` | HTTP only | **yes** |
| `worker` | background work only, no HTTP listener | **yes** |

Unset or empty means `all`, so the current single `bookly-api` process works
unchanged. An unknown value stops the boot with an error.

## Entry points

- `node dist/index.js` honours `PROCESS_ROLE` (`worker` hands over to the worker entry).
- `node dist/worker.js` is always a worker (`npm run start:worker`, `npm run dev:worker`).
- `apps/api/ecosystem.config.cjs` defines `bookly-api` + `bookly-worker` for pm2 (not applied).

## Why split mode requires Redis

Without Redis the API hands work to itself with `setImmediate`. In a split
deployment that would run inbound messages and webhook deliveries inside the API
and leave the worker with nothing, or lose them. Both roles check `REDIS_URL` at
boot and exit with a clear message. Without Redis, run `all`.

(Notification and reminder jobs are already not scheduled when Redis is absent.)

## What lives where

- Background tasks are listed in `apps/api/src/background/tasks.ts`
  (`BACKGROUND_TASKS`). **Add a sweeper or queue worker there**, one entry,
  and it runs in `all` and `worker` automatically. Never register one in
  `index.ts`.
- HTTP routes are registered in `buildApp()` in `apps/api/src/index.ts`.
- Event delivery nudges (`setDeliveryDispatcher`) are installed in every
  process that can publish events (api, worker, all).
- Live updates: the WebSocket fan-out is in-memory in the API. In split mode the
  worker forwards each `publish()` over Redis channel `bookly:realtime` and the
  API replays it to its sockets (`background/realtime-bridge.ts`).

## Shutdown

SIGTERM/SIGINT: background tasks stop first (BullMQ workers drain in-flight
jobs, sweepers stop), then unwiring, then the HTTP server/Prisma/Redis close.
A 25 s ceiling forces exit; pm2 `kill_timeout` is 30 s.

## Running more than one process: sweeper safety audit

| Task | Safe in several processes? |
|---|---|
| notification / reminder workers | Yes (BullMQ job locks) |
| inbound worker | Yes (atomic `claimInboxRow`) |
| webhook delivery worker | Yes (atomic `claimDelivery`, per-tenant cap re-checked after claim) |
| hold-expiry sweeper | Yes (`updateMany` WHERE still PENDING_PAYMENT + UNPAID; count 0 skips; no double notification) |
| webhook delivery sweeper | Yes (stuck recovery re-checks `claimedAt`; re-dispatch is idempotent, jobId = row id) |
| purges (inbox, events) | Yes (delete by id with status re-check; deleting twice is a no-op) |
| inbound sweeper, stuck-row recovery | **Mostly.** The PROCESSING to PENDING reset matches on `status` only, not `claimedAt`. With two sweepers, one can reset a row another process re-claimed a moment earlier, causing a second run of the handler (handlers dedupe on message id, so the effect is a skipped duplicate, not a double reply). Add `claimedAt: { lt: cutoff }` to that `where` before running several workers. |

Until then: one `bookly-worker`. Rolling restarts briefly overlap two, which the
table above tolerates.

## Rate limiting

`plugins/rate-limit.ts`: authenticated requests are limited per user (the token
is verified in `onRequest` just before the limiter), everything else per client IP
(real IP via `TRUST_PROXY`). The `/auth` surface is always per IP. State is
in-memory per process, which matches the single API process.
