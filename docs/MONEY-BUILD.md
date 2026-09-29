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
- [ ] **4. Refunds** — cancelling a paid booking reverses the tenant's credit and
      the fee, from pending or available depending on what cleared.
- [ ] **5. Payout destination** — add and verify a MoMo number via Paystack
      transfer recipients. Cooling-off before a new destination can be paid to.
- [ ] **6. Request a withdrawal** — owner-only, balance re-derived inside a
      serializable transaction, no negative balances, velocity cap.
- [ ] **7. Send the money** — Paystack Transfers plus `transfer.success` /
      `transfer.failed` webhooks; failure returns funds to available.
- [ ] **8. SMS on Bookly's account** — platform Arkesel key with per-tenant
      metering, so one tenant cannot burn the budget.
- [ ] **9. Money screen (web)** — what's ready, what's still clearing, where it
      goes, one withdraw action.
- [ ] **10. Money screen (mobile)** — same, phone-first.
- [ ] **11. Security review** — full money path: idempotency, concurrency,
      authorisation, float safety, audit coverage.
- [ ] **12. Structure & flow PDF** — architecture and money movement, for the
      record and for Paystack.

---

## Blocked on you (not on code)

- **Written aggregator/marketplace approval from Paystack.** Collecting for
  third parties without it risks the account being frozen with tenant money in
  it.
- **Registered business status.** Paystack Transfers are gated on it.

Neither blocks development. Both block real money.
