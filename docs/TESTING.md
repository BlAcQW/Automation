# Testing

Two suites, on purpose.

| | Unit suite | Database suite (A10) |
|---|---|---|
| Command | `npm test` (vitest, no config) | `npm run test:db -w apps/api` (runs `apps/api/scripts/test-db.sh`) |
| Prisma | Mocked | Real client, real Postgres 16, every migration applied |
| Speed | Seconds | About 10 s startup (container + `prisma migrate deploy`), then about 40 s |
| Needs | Nothing | Docker, and the `postgres:16-alpine` image |
| Finds | Logic errors | Transactions, row locks, unique-constraint idempotency, the tenant guard on the real engine, columns that do not exist |

The unit suite mocks Prisma, so it has never exercised a serializable
transaction, a `SELECT ... FOR UPDATE`, a unique index, or whether a column
exists. Functions typed `prisma: any` escape `tsc` too, which is how a write to
a column that never existed (`takeoverAt`) survived in production for months.
The database suite exists to close that gap.

## Running the database suite

```bash
npm run test:db -w apps/api                 # everything
npm run test:db -w apps/api -- test/db/ledger     # a file (extra args go to vitest)
npm run test:db -w apps/api -- -t "overdraw"      # by test name
TEST_DB_KEEP=1 npm run test:db -w apps/api        # leave the container up to poke at it
```

(`npm run test:db` is `scripts/test-db.sh`; the script can also be run directly.)

The script:

1. starts a throwaway `postgres:16-alpine` on a random loopback port
   (`127.0.0.1:<random>`), data on tmpfs, `fsync` off, labelled
   `bookly.test-db=1`;
2. creates a database named `bookly_test_<12 hex>` and stamps it with a
   one-time marker (`ALTER DATABASE ... SET bookly.throwaway = '<token>'`);
3. generates `DATABASE_URL` itself (random password) and runs
   `prisma migrate deploy`, so the schema is exactly what production gets;
4. runs `vitest run -c vitest.db.config.ts`;
5. removes the container on exit, failure, `Ctrl-C` and `SIGTERM`.

Test files are `apps/api/test/db/**/*.dbtest.ts`. The `.dbtest.ts` suffix is
deliberate: the default `vitest run` only matches `*.test.ts` / `*.spec.ts`, so
the fast suite never picks these up and never needs a database.

## Isolation model

One database, **one test at a time**, tables truncated before every test
(`TRUNCATE ... RESTART IDENTITY CASCADE` over every table except
`_prisma_migrations`, in `test/db/helpers/setup.ts`).

Why serial rather than a schema per worker: the thing under test is concurrency,
and it is created *inside* a test (`race(n, fn)` fires `n` calls at once on the
real connection pool). Parallel files would only add cross-test noise, and a
schema per worker would need a migration run per worker for no gain. The whole
suite is a minute of work, so serial is cheap. Tests must not depend on each
other: nothing survives the truncate.

Two clients (`test/db/helpers/db.ts`):

* `guardedPrisma()` is the app's own extended client, obtained by registering
  `plugins/prisma.ts` on a Fastify instance. It is the code under test, with the
  real tenant guard and real mode resolution.
* `rawPrisma()` is a plain `PrismaClient`. Use it to seed and to read results
  back, so a verification read is never blocked by, or hidden behind, the guard.

Seeds (`test/db/helpers/seed.ts`) build wallets from real ledger movements.
`makeFastify()` (`fake-fastify.ts`) gives services the slice of Fastify they use
(real prisma, silent logger, stubbed BullMQ queues). Redis, Paystack and the
Graph API are never contacted: queues and `fetch` are stubbed per test.

## Safety guard

The suite refuses to run against anything but the database the script just
created (`test/db/helpers/guard.ts`, enforced in the vitest global setup, in
every worker, and before every test). All must hold:

1. host is loopback and the database name matches `bookly_test_<12 hex>`;
2. the URL matches none of the `DATABASE_URL` / `DIRECT_URL` /
   `SHADOW_DATABASE_URL` values in `apps/api/.env`, the repo `.env`,
   `prisma/.env` or `DOTENV_CONFIG_PATH`;
3. `DATABASE_URL` equals the `BOOKLY_TEST_DB_URL` the script generated;
4. the live database carries this run's marker token (checked over a real
   connection). A production database cannot have it.

`test-db.sh` also `unset`s `DATABASE_URL` and friends before generating its own,
and never reads a `.env`. The refusals are themselves tested
(`test/db/guard.dbtest.ts`). Running `npx vitest -c vitest.db.config.ts` by hand
fails immediately with `REFUSING TO RUN THE DB TESTS`.

## What the database suite covers

| File | Proves |
|---|---|
| `ledger.dbtest.ts` | Concurrent `postMovement` on one wallet never overdraws (wallet lock); refund vs clearing on the same pending money cannot both win; idempotency keys: one movement, duplicates reported; balances derive from the log and every movement sums to zero; rolled-back movements leave nothing; first-ever wallet creation; `createWithdrawal` under concurrency (serializable): one succeeds, one payout in flight. |
| `fulfillment.dbtest.ts` | Concurrent duplicate fulfilment of one charge: one claim, one credit, one `payment.succeeded` (`dedupeKey`); a late payment on a CANCELLED booking does not resurrect it, raises one alert and credits PENDING only; underpayment; non-platform route credits nothing. |
| `inbound-outbox.dbtest.ts` | `(conversationId, whatsappMsgId)` dedupe incl. concurrent redelivery and handled/unhandled reuse; outbox claim: concurrent resends send once, fresh vs stale `SENDING` claims, retryable vs permanent failure, quota rolled back, takeover suppression. |
| `tenant-guard.dbtest.ts` | On the real engine: an unscoped query throws inside a bound tenant context (also inside `$transaction`, across awaits and interleaved tenants), a scoped one works, admin and no-context are allowed. |
| `events.dbtest.ts` | `publishEventOnce`: concurrent publishes write one row and one delivery per subscription; different tenants may reuse a key. |
| `usage.dbtest.ts` | `tryReserveOutbound` respects the cap exactly under concurrency; rollbacks never go negative. |
| `rides.dbtest.ts` | RIDES pack races: customers racing for the 50th Founding slot (one wins); eight concurrent deliveries of one payment activate once (one +60 entry); late payment after the hold lapsed with the cap full is recorded and alerted, not activated; a double COMPLETED deducts once (60 -> 59, UNIQUE(rideId)); concurrent same-driver assigns change once; concurrent PAYG past the daily limit gets exactly `limit` seats and the sweep returns unpaid ones; expiry (EXPIRY entry) and once-only reminders; every console query on the real schema inside a tenant context. |
| `rides-journey.dbtest.ts` | E1: TURBO's whole WhatsApp journey through the production turn handler, the real flow, payment preparers, webhook dispatch + fulfillers, console routes (real auth plugin) and `/v1/rides` (real API key): Hi -> buy -> pay -> activate -> book -> assign -> complete -> balance 59 -> history -> PAYG -> capacity limit -> app booking. Paystack, the WhatsApp send and SMS/email are mocked. |
| `sweep-*.dbtest.ts` | Column-existence sweep (below). |
| `guard.dbtest.ts`, `blind-spots.dbtest.ts` | The safety guard and the static blind-spot scan. |

## The column-existence sweep

`sweep-conversations`, `sweep-flows-events`, `sweep-money`, `sweep-orders-admin`
call each service or route function that takes a loosely typed Prisma against
the real schema and then assert on the **rows**, not on "did not throw". That
matters: several call sites swallow errors (`.catch(() => undefined)`,
`section()` in the admin attention query), so a write to a missing column would
otherwise pass silently. Covered: human takeover, booking cancel (customer
forfeit and business refund), the refund retry sweep, conversation resolver,
customers, notifications and reminders, hold expiry, customer memory, flow store
and definitions, flow ports, external app, webhook inbox, webhook delivery,
idempotency lock, tenant onboarding, billing statement, emergency switches,
order creation, the admin attention query.

### Known blind spots (static scan)

`test/db/helpers/blind-spots.ts` greps `src` for `prisma: any` / `: unknown`,
casts (`prisma as any|never|unknown`) and loose aliases (`type X = any`).
List them with `npx tsx apps/api/test/db/helpers/blind-spots.ts`.
`blind-spots.dbtest.ts` fails when a source file gains such a site that is not
listed here, so a new blind spot has to be acknowledged (and ideally covered).
Add the file to the table with how it is covered.

| File | Sites | What is loose | Coverage by the DB suite |
|---|---|---|---|
| `routes/admin-billing/index.ts` | 1 | route cast around `getStatement` | Function covered (`sweep-money`: statement from real BillingTerms + DomainEvent counts). The route wiring/auth is not. |
| `routes/admin/attention.ts` | 9 | `prisma: any` in every section query | Covered: `buildAttention` runs all seven sections on real data and asserts none degraded to `unavailable` (`sweep-orders-admin`). |
| `routes/admin/flows.ts` | 1 | (new, not yet triaged) | NOT covered: triage me. |
| `routes/admin/index.ts` | 1 | `fastify.prisma as any` into the onboarding deps | Covered via `createTenantWithOwner` (`sweep-money`). Route wiring not. |
| `routes/admin/messaging.ts` | 1 | `prisma: any` on the messaging-health query | NOT covered (landed while this suite was written). Same pattern as `buildAttention`. |
| `routes/admin/money.ts` | 2 | `buildMoneyOverview(prisma: any, ...)`, `namesFor` | NOT covered (admin money oversight landed while this suite was written). Same pattern as `buildAttention`: seed wallets/payouts, call it, assert the result. |
| `routes/admin/organisation.ts` | 1 | `moneySummary(prisma: any, ...)` | NOT covered (not exported). Needs a route-level test with a real app. |
| `routes/auth/index.ts` | 1 | `tx as unknown as ExtendedPrismaClient` for the signup wallet | NOT covered. Signup route is not driven against the DB. |
| `routes/conversations/index.ts` | 1 | `announceHandoff(prisma: unknown, ...)` | Underlying `emitConversationHandoff` covered (`sweep-conversations`); the route helper is not. |
| `routes/orders/index.ts` | 1 | `$transaction(async (tx: any)` cancel-and-restore-stock | NOT covered (create path is: `createOrderAtomic`). Cancel/restore-stock needs a route-level test. |
| `routes/v1/idempotency.ts` | 1 | `acquireKeyLock(tx: any, ...)` | Covered (`sweep-flows-events`: advisory lock 409 under contention). |
| `routes/v1/messages.ts` | 2 | `sendOnce(db: any, ...)`, `$transaction(async (tx: any)` | NOT covered. Public API v1 send needs a route-level test. |
| `routes/v1/shared.ts` | 1 | `publishBestEffort(prisma: unknown, ...)` | Underlying `publishEvent` covered (`events`); the wrapper is not. |
| `routes/whatsapp/inbound-events.ts` | 1 | `externalAppIsLive(prisma: any, ...)` | Covered (`sweep-conversations`). `linkCustomerOnInbound`/`prepareInbound` are not. |
| `routes/whatsapp/inbound-store.ts` | 3 | `findInbound/insertInbound/markInboundHandled(prisma: any, ...)` | Covered (`inbound-outbox`). |
| `routes/whatsapp/system-message.ts` | 1 | `holdingSentRecently(prisma: any, ...)` | `holdingSentRecently` covered (JSON-path filter on real Postgres). `sendSystemMessage` is not. |
| `services/customers.ts` | 1 | `type CustomerDb = any` for every helper | Covered (`sweep-conversations`: upsert, link, email resolution). |
| `services/events/delivery.ts` | 5 | `prisma: any` on claim/process/sweep/purge | Covered (`sweep-flows-events`). |
| `services/events/emit.ts` | 12 | `prisma: unknown/any` on every emit helper | `publishEventOnce`, `emitConversationHandoff`, `emitMessageReceived` path via `publishEvent` covered (`events`, `sweep-*`). `emitBooking*`/`emitOrderCreated`/`emitPayment*` wrappers share `publishEventSafe` but are not each exercised. |
| `services/events/publish.ts` | 7 | `prisma: any, tx: any` throughout | Covered (`events`, `fulfillment`, `sweep-*`): rows, fan-out, dedupeKey. |
| `services/external-app.ts` | 2 | `withAdvisoryLock(... tx: any)` | Covered (`sweep-flows-events`). `fulfillExternalAppPayment` is not. |
| `services/flow-events.ts` | 1 | `emitFlowCompleted(prisma: unknown, ...)` | Covered (`sweep-orders-admin`). |
| `services/flow-payments.ts` | 1 | `loadConversation(prisma: any, ...)` and the flow_payment fulfiller | `advanceFlowOnPackPayment` (pack kinds) covered end to end (`rides-journey`). `fulfillFlowPayment` itself is NOT covered. |
| `services/flow-ports.ts` | 3 | `prisma: any` in `FlowPortsDeps` and in `FlowPaymentPrepareInput` (pack payment preparers) | `enqueueStaff` covered (`sweep-flows-events`). `createPaymentLink` with a preparer (ride_package / ride_payg) covered end to end with a Paystack double (`rides-journey`); the plain flow_payment link is not. |
| `services/flows/store.ts` | 1 | `type Fn = (args: any)` delegates | Covered (`sweep-flows-events`: definitions, versions, optimistic `saveBotContext`). |
| `services/human-takeover.ts` | 4 | `prisma: any` on all four functions | Covered (`sweep-conversations`: the takeoverAt regression). |
| `services/inbound-queue.ts` | 6 | `prisma: any` on every inbox function | Covered (`sweep-flows-events`). |
| `services/ledger.ts` | 4 | raw `$queryRawUnsafe` lock; `raiseAlert(... as never)` | Covered (`ledger`, money sweeps). The currency-mismatch alert path is not. |
| `services/notification-purposes.ts` | 2 | `db: any` in reminder checks | Covered (`sweep-conversations`: `reminderStillApplies`). |
| `services/order-create.ts` | 2 | `prisma as any`, `$transaction(async (tx: any)` | Covered (`sweep-orders-admin`: oversell race, rollback, totals). |
| `services/payment-fulfillment.ts` | 5 | `prisma: unknown/any` on the event helpers | Covered (`fulfillment`, `events`). `ensurePaymentSucceededOnReturn` is not. |
| `services/tenant-onboarding.ts` | 1 | structural `prisma` with `tx: any` | Covered (`sweep-money`). |
| `services/email-claim.ts` | 1 | `tx: any` (transaction client) | Covered (`sweep-money`: double-submitted onboarding creates one organisation). |
| `services/order-expiry.ts` | 2 | `tx: any` in the cancel transaction, typed rows from `findMany` | Covered (`sweep-orders-admin`: staff cancels racing the expiry sweep restock exactly once). |

"NOT covered" rows are the to-do list: each needs a test that drives the
function (or route) against the real database and asserts on the rows.

## Writing a database test

* Assert on rows with `rawPrisma()`; do not trust "no error".
* Create contention with `race(n, fn)` (`helpers/concurrency.ts`). Warm the pool
  first if the race is about a first insert (`Promise.all(30 x prisma.tenant.count())`),
  otherwise the first connections open serially and hide the race.
* Inside `tenantContext.run(...)` the callback must `await` the query
  (`async () => await prisma.x.findMany(...)`). A Prisma query is lazy and its
  `$extends` guard runs when first awaited; returning the bare promise out of
  `run()` executes it with no context and the guard sees no tenant.
* Redis, Paystack and the Graph API are stubbed: `makeFastify()` queues,
  `vi.stubGlobal('fetch', ...)`, `vi.mock('.../paystack.js')`.
* Prisma prints failed-query errors to stdout even when the code handles them.
  That noise in the run output is expected for the race tests.
* A test that is red pins a real bug. Do not weaken it; fix the source.

## Bugs pinned by red tests (found by this suite)

Tests named `BUG: ...` or described below assert the CORRECT behaviour and fail
until the source is fixed. Money is never at risk in any of them (the
invariant tests next to each hold); they are availability and correctness
defects.

| Test | Defect |
|---|---|
| `ledger.dbtest.ts` "BUG: two first-ever payments..." and "BUG: concurrent ensureWallet..." | `ensureWallet` race: the loser of the first-wallet insert throws, so its credit fails ("replay this reference"). The current `tx.wallet.upsert({ update: {} })` does not help: Prisma emits an atomic `INSERT ... ON CONFLICT` only when `update` is non-empty; with `update: {}` it does select-then-insert and still raises P2002 (verified: 63 failures in 72 racing upserts with `{}`, 0 with `{ messageCount: { increment: 0 } }`). |
| `ledger.dbtest.ts` "BUG: losing concurrent withdrawals..." | Postgres reports `40P01 deadlock detected` from `lockWallet`'s raw `FOR UPDATE`, which Prisma raises as `P2010` with `meta.code`. `payout-request.ts` `isSerializationFailure` only checks `err.code` `40001` / `P2034`, so the losers get a raw Prisma error (HTTP 500) instead of `WithdrawalConflictError`. |
| `usage.dbtest.ts` "BUG: concurrent first reservations..." | `tryReserveOutbound` (and `incrementPlatformSmsUsage`) upsert the `TenantUsage` row with `update: {}`: same non-atomic upsert, P2002 for the losers of the first reservation of a cycle. The cap itself holds. |
| `sweep-conversations.dbtest.ts` "concurrent first contacts..." | `resolveConversation` is find-then-create and does not handle the P2002 a lost race raises. |
| `sweep-money.dbtest.ts` "a double-submitted admin form..." | `createTenantWithOwner` checks the owner email, then creates; the only DB constraint is `(tenantId, email)`, which a new tenant cannot violate, so the `P2002 -> DuplicateOwnerEmailError` catch is dead code and concurrent submits create several tenants for one email. |
