# Money: platform-collected payments & payouts

Build checklist. Customers pay into **Bookly's** Paystack account; tenants never
create a gateway account or handle an API key. Earnings land in a ledger and go
out to Mobile Money on request. SMS moves to Bookly's Arkesel account for the
same reason.

**Rules this work is held to:** [money-ledger](../.claude/skills/money-ledger/SKILL.md)
· [tech-illiterate-ux](../.claude/skills/tech-illiterate-ux/SKILL.md)

---

## Settings and their defaults

| Setting | Default | Why |
|---|---|---|
| Platform fee | **Percentage**, in basis points. Rate still **0 (off)** until a number is chosen | Percentage confirmed as the model; the ledger takes basis points so no float ever touches a fee |
| Clearing trigger | **The moment the job is marked done** | Confirmed. Not a timer — the owner marking a booking COMPLETED (or NO_SHOW, where the deposit is the compensation) releases the money. Orders clear on DELIVERED |
| Collection route | Platform, unless the tenant has their own Paystack key | Existing tenants keep working; nobody new has to set anything up |

---

## Checklist

- [x] **0. Ledger foundation** — wallet, append-only double-entry ledger, payout
      tables, movement builders, 25 tests. `a2c2913` / `5fac707`
- [x] **1. Collect into Bookly's Paystack** — payment links fall back to the
      platform key when the tenant has none. A tenant with their own key keeps
      using it, so nothing breaks for anyone already live.
- [x] **2. Credit the ledger when a payment lands** — webhook → `DEPOSIT_RECEIVED`,
      idempotent on the provider reference.
- [x] **3. Clear funds on completion** — marking a booking COMPLETED or NO_SHOW
      (an order DELIVERED) moves `TENANT_PENDING` → `TENANT_AVAILABLE`. Event
      driven, so no scheduled job and no waiting: they finish the job, the
      money is theirs.
- [x] **4. No refunds — reschedule instead.** Deposits are non-refundable: a
      customer who cancels forfeits it, which is what makes holding the slot
      worth anything. Rescheduling updates the same booking, so the deposit
      carries over with no ledger movement at all. The one exception policy
      cannot cover is the SALON cancelling — that money is held, not released,
      because keeping a customer's money for work nobody will do is
      indefensible however the terms read — and the alternative to refunding is
      a chargeback that costs more. That refund is **automatic**: money never
      sits in a state with no owner and no exit.
- [x] **5. Payout destination** — add and verify a MoMo number via Paystack
      transfer recipients. Cooling-off before a new destination can be paid to.
- [x] **6. Request a withdrawal** — owner-only, balance re-derived inside a
      serializable transaction, no negative balances, velocity cap.
- [x] **7. Send the money** — Paystack Transfers plus `transfer.success` /
      `transfer.failed` webhooks; failure returns funds to available.
- [x] **8. SMS on Bookly's account** — platform Arkesel key with per-tenant
      metering, so one tenant cannot burn the budget.
- [x] **9. Money screen (web)** — what's ready, what's still clearing, where it
      goes, one withdraw action.
- [x] **10. Money screen (mobile)** — same, phone-first.
- [x] **11. Security review** — done, adversarial. Found **1 CRITICAL** (a
      tenant could credit their wallet with money that never reached Bookly and
      withdraw it — the collection route was inferable from attacker-controlled
      data) and **4 HIGH**. All five fixed: `3bc67f9`, `269beb6`. Plus an
      underpayment hole found separately: `7cb09d1`.
      The remaining 6 MEDIUM and 7 LOW were closed in wave 3 (A1/A2), see
      "Security findings" below.
- [x] **12. Structure & flow PDF** — [money-structure-and-flow.pdf](strategy/money-structure-and-flow.pdf),
      5 pages. Written for the team and for the Paystack aggregator
      conversation: the flow, the ledger, what happens to a deposit, the
      controls, and the limits — including the ones left open on purpose.

---

## Security findings

From the adversarial review. All closed in wave 3 (A1 currency, A2 findings),
each with tests. Nothing here is committed or deployed yet.

**MEDIUM**
- [x] **STAFF can trigger a refund** via `POST /bookings/:id/cancel`. A salon
      cancel of a paid deposit refunds the customer, which is money leaving, so
      it is now **owner-only**. Staff keep cancelling everything where no money
      moves (unpaid holds, deposits paid into the tenant's own gateway). Decided
      by `cancelMovesMoney`: paid and not `OWN_GATEWAY` (a paid booking with a
      missing or unknown route fails closed to owner-only). Moving the refund
      decision server-side would only have hidden the same money movement behind
      a staff click. `PATCH /bookings/:id {status: CANCELLED}` used to flip the
      status with no refund at all (stranding the deposit in pending), so a
      CONFIRMED booking now goes through the same shared cancel and the same
      owner rule.
- [x] **Transfer went to a re-queried recipient.** `createWithdrawal` returns the
      recipient it validated (usable, past cooling-off, has a provider code) and
      stores it on the payout; the route pays exactly that code and no longer
      re-reads the destination.
- [x] **Currency was never validated (A1).** One source, `DEFAULT_PAYMENT_CURRENCY`
      (GHS), sets `Tenant.paymentCurrency` explicitly (the schema default is
      still NGN) and creates the wallet in the same transaction, in self-register
      and admin onboarding. Every `postMovement` asserts the movement currency
      equals the wallet currency and throws `LedgerCurrencyMismatchError` (the
      caller raises the critical alert from outside the rolled-back transaction).
      `deriveBalances` sums only the wallet currency. Payout recipients, the
      network list and the transfer itself are in the wallet currency. A charge
      in a different currency from what was asked (the wallet's, for
      platform-collected money; the tenant's, for own-gateway) is rejected like an
      underpayment.
- [x] **Payout state machine gaps.** Every transition is a conditional update.
      The route's `PROCESSING` update is guarded on `REQUESTED` (a late write can
      no longer drag a settled payout back) and the provider reference is still
      recorded. `transfer.reversed` after success reverses the settlement
      (EXTERNAL to AVAILABLE) with a critical alert and an owner notification.
      Contradictory events (success for a payout already returned, failure for
      one already settled) move no money and raise a critical alert. A reaper
      (`payout-reaper.ts`) flags payouts in flight for over an hour with a
      critical alert and an audit row; it never changes them, because an
      uncertain transfer may have been sent.
- [x] **Underpayment returned 200 with nothing recorded.** Now a critical alert
      per reference, an audit row and a `payment.failed` event. The webhook still
      answers **200**, deliberately: the verdict is deterministic, so a retry can
      only reach the same answer and would just hammer the endpoint for three
      days. What a retry can fix is a failure to *record* it, and that still
      throws (5xx) so the redelivery writes it. The money is neither credited nor
      refunded by the code; the alert asks a person to refund the customer.
- [x] **Refund route was re-resolved from the tenant's current key.** The refund
      now reads the route stored on the booking when its link was made.

**LOW**
- [x] **Rate limits were effectively per-IP.** Fixed globally by the
      identity-aware rate-limit plugin (`plugins/rate-limit.ts`); the money and
      payment per-route limiters now key by tenant.
- [x] **Webhook answered differently for known and unknown tenants.** Unknown
      tenant, no key to verify with and bad signature all answer the same 401.
- [x] **No step-up auth; first destination used silently.** Withdraw and
      destination change need the account password again (verified server-side,
      failures audited as `money.step_up_failed`). The owner is notified when a
      destination is added **or** changed.
- [x] **P2002 caught inside a transaction.** `postMovement` looks the key up
      inside the wallet lock instead of catching the unique violation, and
      `ensureWallet` creates through an upsert; neither aborts the transaction.
- [x] **Daily payout cap was a calendar day.** Now a rolling 24 hours.
- [x] **`/money/destination/preview` number-to-name oracle.** Per-tenant quota
      (20 per 10 minutes, 60 per day), a **platform-wide hourly ceiling** (600
      new lookups across all tenants, so registering more tenants does not add
      up to an oracle) and a 10-minute per-tenant cache; a cached repeat costs
      nothing and does not count. The counters are **Redis fixed windows** when
      Redis is configured (shared across instances) and in-memory otherwise or
      when Redis errors (never skips the limit; with N instances and no Redis the
      effective quota is N times higher). A tenant refused on its own quota does
      not spend the platform ceiling.
- [x] **Ledger and payout rows cascade-delete with the tenant.** Ledger rows have
      no `Tenant` FK on purpose (a financial record should not be tied to the
      lifetime of the row that describes its owner), but `Wallet` cascades from
      `Tenant` and entries and payouts cascade from `Wallet`. Nothing deletes
      tenants today (the admin deactivates). The rule is: **a tenant that has
      handled money is deactivated, never deleted**, enforced for any future
      delete path by `tenantDeletionBlockers` (`wallet-retention.ts`). No schema
      change.

## Deliberately not done

- **No hold period before withdrawal.** The owner asked for funds to clear the
  moment a job is marked done. The state machine blocks the instant fraud, but
  not the patient version (book for 10 minutes' time, wait, complete,
  withdraw). A new-tenant-only hold would close it without penalising
  established salons. The owner's call.

## Known gaps

- [x] **A failed refund needed a retry path.** A refund Paystack rejects after a
      salon cancel is parked (`depositState = 'REFUND_PENDING'`, attempt count,
      next attempt, last error) and retried by `refund-retry.ts` with backoff
      (1m, 5m, 15m, 1h, 3h, then every 6h). Warning alert from the first failure,
      critical from attempt 5, and a critical `refund.retry_exhausted` after 12.
      Parked means a clearing or a second refund cannot claim the deposit. A
      claim stranded in `REFUNDING` by a crashed attempt is recovered after 15
      minutes. A provider answer of "already fully reversed" counts as success,
      so a refund that went through but timed out is not retried forever. The
      sweeper must be started: `startRefundRetrySweeper(prisma, log)` (and
      `startPayoutReaper`) in `index.ts`.
- [x] **Order late-payment guard and refund.** A payment landing on a CANCELLED
      order no longer re-opens it: the row is marked PAID (status untouched), the
      money is credited as pending, a critical `payment.after_order_cancelled`
      alert goes out first (so a crash cannot lose it) and the customer is then
      **refunded automatically** by `order-refund.ts`, mirroring the booking
      refund: atomic claim on `Order.depositState` (null to `REFUNDING`) before
      the provider call, refund on the route STORED on the order (anything but
      `PLATFORM` fails closed), ledger movement keyed `refund:order:<id>` posted
      only after the provider confirms, "already fully reversed" counts as
      success. **No automatic retry**: Order has no retry columns (no schema
      change), so a provider or ledger failure parks the order in
      `REFUND_PENDING`, leaves the money pending and raises a critical
      `order.refund_failed` / `order.refund_ledger_failed` alert carrying the
      `orderId`; a person re-runs `refundOrderPayment({ ..., retry: true })`
      (no route or screen calls it yet). A claim stranded in `REFUNDING` by a
      crash is also left for a person. An order staff already moved on is
      marked paid without its status going backwards.
- [x] **Payout switch.** `createWithdrawal` and the transfer step refuse while
      `isPayoutsPaused` says so. A request caught between the two has its
      reservation returned (nothing was sent). A switch that cannot be read counts
      as paused. The owner sees a plain message, never the admin's reason.
- **Not automated: some refunds.** A late booking payment (after the hold
  expired), underpayments and wrong-currency charges are held or left at the
  provider and rely on the critical alert for a person to refund. A late ORDER
  payment is refunded automatically (see above); its failed refund is retried by
  a person, not a sweeper.
- **A paid order cancelled by staff** is not refunded by any code path (only the
  late-payment case is wired). The money stays pending.
- **Platform-collected links in a non-wallet currency.** `createPaymentLink`
  (not part of this wave's ownership) still asks for `Tenant.paymentCurrency`
  even on the platform route. A tenant whose payment currency was changed (own
  gateway in NGN, later disconnected) would be sent a platform link in a currency
  the wallet refuses; the charge is then rejected and alerted, never credited.

## Blocked on you (not on code)

- **Written aggregator/marketplace approval from Paystack.** Collecting for
  third parties without it risks the account being frozen with tenant money in
  it.
- **Registered business status.** Paystack Transfers are gated on it.

Neither blocks development. Both block real money.


## Wave 3 review fixes (money and billing)

- [x] **Refund retry could drop a parked refund.** `refundDepositForBooking`
      returned `nothing_to_refund` both when nothing was left and when its claim
      lost a race, and the sweeper stopped retrying on every `nothing_to_refund`.
      With two sweepers a re-parked refund was removed from the queue with a
      false alert. A lost claim is now its own outcome, `claim_lost`, and the
      sweeper does nothing on it. The stop write also alerts only if it actually
      matched a parked row. Tests: two-sweeper interleaving (unit) and a real-DB
      race.
- [x] **Billing undercount when the unit type is set after the terms.**
      Fan-out events are stored only while a subscriber or the unit type wants
      them, so rows from before a unit type was set are an arbitrary subset.
      Usage is now counted from when the CURRENT unit type was last set, taken
      from the audit trail (`billing.terms.updated` before/after: the newest
      edit that moved `unitEventType` into its current value; creation with the
      unit counts from creation). Not `BillingTerms.updatedAt`: it also moves on
      a fee edit, which would silently drop usage. With no audit row (terms
      written outside the admin route) it falls back to `createdAt` and the
      statement says it may undercount. The statement carries `unitCountedFrom`,
      prints "Units counted from <time> UTC", warns when counting began inside the
      period (earlier usage not included), counts zero for a period that ended
      before counting began, and notes the 30 s per-process cache on the unit type
      (events published in that window after a change may be missing).
- [x] **Money screens treated every 400 as a password error.** Withdrawal
      refusals (daily limit, paused) and "we are checking your balance, do not try
      again" are also 400. The server now sends a stable `code` only for password
      problems: `PASSWORD_REQUIRED` (400), `PASSWORD_INCORRECT` (403),
      `PASSWORD_LOCKED` (429, with Retry-After). Sent directly by the route,
      because the global error handler drops `code`. Web and mobile keep the
      password form open only for the first two; everything else closes the step
      and shows the message verbatim, without "Nothing was sent".
- [x] **Preview oracle quota** is now also platform-wide and Redis-backed (see the
      security list above).
- [x] **Step-up lockout.** 5 consecutive wrong passwords for one tenant user lock
      withdraw and destination change for 15 minutes (Redis when available,
      memory otherwise, via `admin-throttle.ts`), even for the right password;
      a success clears the count; audited as `money.step_up_locked`. A missing
      password is not an attempt. `verifyStepUp` also refuses an inactive user
      (answered like a wrong password).
- [x] **Payout alert noise.** A redelivered `transfer.success` for a payout that
      was settled and then reversed (FAILED, with a `payout-settled:<id>`
      movement) is a duplicate, not a contradiction: no alert. A success for a
      payout that FAILED without ever settling still raises a critical
      `payout.paid_after_failed`, one per payout (dedupe key).
- [x] **Paystack refund idempotency.** `POST /refund` accepts only transaction,
      amount, currency, customer_note and merchant_note: there is no idempotency
      key. Replay safety rests on the provider's "already fully reversed" answer
      (treated as success) and the per-entity ledger key. `merchant_note`
      (`refund:booking:<id>` / `refund:order:<id>`) is sent for traceability only.
