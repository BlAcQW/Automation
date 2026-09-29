---
name: money-ledger
description: Architecture and safety rules for any code that moves, holds or accounts for money in Bookly — customer payments, tenant balances, withdrawals, refunds, fees and platform revenue. Use this BEFORE designing or changing any payment, wallet, payout, ledger or settlement code, and when reviewing such code for correctness or fraud risk. Covers double-entry ledgers, idempotency, concurrency, float safety, payout controls and the specific ways money code fails silently.
---

# Money & Ledger Architecture

Rules for code that touches other people's money. These are not style
preferences. Every one of them exists because the alternative loses funds,
double-pays, or cannot be audited after the fact.

---

## The one rule everything else serves

**A balance is never a number you edit. It is the sum of an immutable log.**

The moment a balance lives in a mutable column that code increments and
decrements, three things become impossible: proving the balance is correct,
finding out when it went wrong, and recovering after a partial failure. Every
bug then costs real money and cannot be explained to the person who lost it.

So: an append-only `LedgerEntry` table is the truth. A cached balance column is
allowed only as an optimisation, and only if a reconciliation job proves it
still equals the ledger sum.

## Double entry, always

Every movement writes at least two rows that sum to zero. Money is never
created or destroyed, only moved between accounts.

```
Customer pays GHS 50 deposit for a booking:
  +50.00  tenant:<id>:available      (they earned it)
  -50.00  platform:paystack_float    (it arrived in our merchant account)

Tenant withdraws GHS 50:
  -50.00  tenant:<id>:available
  +50.00  platform:payout_pending    (committed, not yet sent)
```

If the two sides of a movement can ever be written separately, they will be —
a crash, a timeout, a deploy mid-request. **Both sides go in one database
transaction, or neither does.**

## Idempotency is not optional

Payment providers retry. Users double-tap. Queues redeliver. Assume every
inbound event arrives at least twice and design so the second arrival is a
no-op.

- Every ledger write carries a **unique idempotency key** derived from the
  event, not generated per call — the provider's transaction reference, the
  payout request id, the booking id plus purpose.
- Enforce it with a **database unique constraint**, not an `if` statement. A
  check-then-insert has a race between the check and the insert, and under
  retry storms that race is not theoretical.
- The existing `fulfillBookingCharge` pattern is the model to follow: an atomic
  `updateMany` guarded on the current state, where only the writer that sees
  `count === 1` performs the side effects.

## Concurrency: assume two withdrawals at once

The classic theft is: request two withdrawals of the full balance
simultaneously, both read the balance before either writes, both succeed.

- Debits run inside a **serializable transaction** that re-reads the balance
  and re-checks sufficiency *inside* the transaction. Checking before opening
  it is the same bug with extra steps.
- Alternatively, or additionally, hold a row lock on the wallet.
- Never trust a balance the client sent. Never trust one read in an earlier
  request.

## Float safety

Money that has arrived is not always money that can leave.

- A payout may only draw on funds that have **settled** with the provider. Cash
  that is in a pending Paystack settlement is not yet ours to send.
- Keep held and available separate: an unpaid booking hold, a disputed charge,
  or a refund in flight must not be withdrawable.
- **Never let a balance go negative.** If maths says it would, the movement is
  a bug — reject it and alert, do not clamp to zero.

## Payout controls

Payouts are the only place value leaves the system, so they get the most
suspicion.

- **Owner only.** Staff must never be able to move money out, no matter what
  else they can do.
- The destination (bank / MoMo number) is a **separate, deliberate step** from
  requesting a payout, and changing it should be treated as a security event:
  audit it, and consider a cooling-off period before the new destination can
  receive funds. Account-takeover fraud works by changing the destination, not
  by stealing the login.
- Apply per-tenant limits and a velocity cap. A sudden change in payout pattern
  is worth flagging even if it is legitimate.
- Every state change is audited with actor, amount, destination and time.

## Money representation

- **Integer minor units only** (pesewas, kobo, cents). Never a float — `0.1 +
  0.2 !== 0.3` and rounding drift in money is unrecoverable.
- Store the currency alongside every amount. An amount without a currency is
  not a value.
- Decimal columns are acceptable where the schema already uses them, but the
  arithmetic happens in integers.

## Reconciliation

Build the ability to answer "does our ledger match the provider?" from day one,
because retrofitting it means auditing history by hand.

- A job that compares ledger totals to provider settlement reports.
- An admin view showing platform float, total tenant liabilities, and the
  difference. **That difference should always be explainable.**

## Regulatory reality — read before designing

Collecting money into a platform account on behalf of other businesses and
paying it out is **money transmission**, and in Ghana it is regulated by the
Bank of Ghana under the Payment Systems and Services Act 2019. Provider terms
also commonly prohibit using a merchant account to collect for third parties
without registering as an aggregator or marketplace.

This is not a reason to avoid the design, but it is a reason to:
1. Confirm aggregator/marketplace status with the provider **in writing** before
   real money flows;
2. Prefer **split-at-source** (the tenant's share settles to their own
   destination at transaction time) where it gives the same user experience,
   since the platform never holds their funds;
3. Keep the ledger clean enough to hand to an auditor, because one day someone
   will ask.

## Review checklist

Before any money code merges:

- [ ] Balance derived from an append-only ledger, not a mutated column
- [ ] Both sides of every movement in one transaction
- [ ] Idempotency enforced by a unique constraint, not a conditional
- [ ] Debits re-check sufficiency inside a serializable transaction
- [ ] Negative balances impossible, and treated as a bug if attempted
- [ ] Held and available funds distinguished
- [ ] Payouts owner-only, destination changes audited
- [ ] Integer minor units throughout; currency stored with every amount
- [ ] Every state change audited with actor and amount
- [ ] Provider webhook signatures verified before any ledger effect
- [ ] Failure path leaves the ledger consistent, not half-written
