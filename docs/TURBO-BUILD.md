# TURBO — build tracker

TURBO is a ride service for Central University students
(https://www.turboghana.app). On Bookly it is an organisation on the **RIDES**
pack: WhatsApp, the scripted bot, payments, the ride balance and dispatch run
inside Bookly. TURBO's staff work in **their own console**, a Next.js app in
`/root/home/turbo` that is branded like their website and talks to Bookly over
HTTPS. When TURBO's mobile app ships, it uses the same customer accounts and
balances through the public API (v1), so nothing has to be migrated.

Source of truth for the customer journey: the "TURBO WhatsApp Bot — Founding 50
MVP" user flow TURBO sent (copied at the bottom of this file).

Rules: tests first, every new table tenant-scoped and guard-registered, the ride
balance is an append-only log (like the money ledger), idempotent on every
payment webhook and inbound message, a package is activated **only** by a
verified payment, a ride is deducted **only** when it is marked COMPLETED.

## Shape

```
Customer (WhatsApp) ──> Bookly: flow engine runs "turbo-founding"
                          │  actions: register, quote ride, request ride, balance…
                          │  payments on TURBO's own Paystack (MoMo, card)
                          │  rides pack: passes, balance log, rides, drivers, PAYG capacity
                          └──> notifications: WhatsApp, then SMS (TURBO's Arkesel), email (TURBO's Gmail)
TURBO console (Next.js, own domain) ──> Bookly /rides/* API (staff login, cross-site)
TURBO mobile app (later) ──────────────> Bookly /v1/rides/* (API key)
```

## Decisions taken (defaults; all are settings unless marked)

| # | Question | Default |
|---|---|---|
| 1 | How is the destination given? | Numbered list of TURBO's saved places, **or** a shared location pin. Distance = straight line × 1.3 road factor (setting). No maps API cost. |
| 2 | Package expiry | 60 days from activation, unused rides expire. Reminder at day 50 and at 5 rides left. |
| 3 | Founding 50 cap | **50 ever sold**: an expired package never reopens a slot. A slot is **held while the customer pays** (30 min), so we never take money for the 51st package. A payment that lands after its hold lapsed and the 50 are gone raises an alert for TURBO to refund (it is their Paystack). |
| 4 | Driver assignment | TURBO operations assign a driver in the console. The driver is told by SMS (optional setting). |
| 5 | PAYG fare | GHS 25 up to 6 km, GHS 35 up to 10 km (as on their website); further is not offered. Daily limit 10, open/closed switch. |
| 6 | Packages per customer | One active package at a time. |
| 7 | Cancelling | Customer can cancel before a driver is assigned (free; package rides are never deducted for it). PAYG cancelled by ops is refunded by TURBO. |
| 8 | Wording | Their copy is used verbatim. Their draft mixes "Founding" and "Pioneer"; the product is named **Founding 50** with "Pioneer" as the button label, as in their draft. Menu numbering in the draft skips 5 and gives 4 twice; fixed to 1 Book · 2 PAYG · 3 Balance · 4 History · 5 Account · 6 Support. |
| 9 | Console domain | Their choice (e.g. `console.turboghana.app`); needs `CROSS_SITE_AUTH=true` and HTTPS. |

### Fares and GHS credit (2026-10-14, client brief "TURBO Developer App Flow & Fare Calculation"; these supersede 1, 2 and 5 where they differ)

| # | Question | Decision |
|---|---|---|
| 11 | Where is the fare measured from? | A **fare reference point** (Central University Student Plaza), a console setting `fareRef {label, lat, lng}`, nullable. Set: price distance = reference -> destination. Unset: pickup -> destination (as before). Same method (straight line x road factor). Coordinates are never guessed: TURBO enters them. |
| 12 | Bands | Inclusive upper bounds (6.00 km is band 1, 10.00 km band 2). 0–6 km: PAYG GHS 25 / package GHS 16; 6–10 km: GHS 35 / GHS 25; over 10 km a **flat** fare, PAYG GHS 50 / package GHS 40, **no maximum distance**. Settings: `paygFares` + `paygOverFareMinor` (5000), `packageFares` + `packageOverFareMinor` (4000). An over fare of null = not offered beyond the last tier (legacy). An over fare below the last tier's fare is refused. |
| 13 | What is the Founding Package? | **GHS credit** = the package price (GHS 960). The band's package fare is deducted at ride **completion**, once (UNIQUE(rideId)); cancelling never deducts. Package rides of any distance. Balance shown in GHS everywhere. `packageRides` / `maxKm` are legacy, unused. |
| 14 | Balance short of the fare | Balance <= 0: no package ride (`no_balance`), PAYG offered. 0 < balance < fare: the whole remaining balance + a Paystack link for the difference (payment kind **`ride_topup`**); the ride is booked only when paid. A difference **under GHS 2 is waived** (booked from the balance alone; `waivedMinor` recorded). |
| 15 | Booking order | Destination first -> fare shown -> pickup pin (for the driver) -> confirm, when `fareRef` is set. Unset: pickup first (old order). The flow branches on its `fare_ref` variable, never on which pickup variables exist. |
| 16 | Unknown typed destination | "I couldn't find that place. 📍 Please send it as a location pin: tap 📎 (or +) → Location → search for the place → tap it to send. Or reply with a number from the list." Three misses: hand-off (as before). |
| 17 | Ride records | `priceDistanceKm`, `priceBasis` (REFERENCE/PICKUP), `fareBand`, `fareMinor` (band fare, both kinds), `balanceAppliedMinor`, `topupMinor`, `waivedMinor`, `deductedMinor`, `balanceAfterMinor`. |
| 18 | Pickup distance limit | None for now. |

Money rules behind 13/14: the balance log (`RidePassEntry.amountMinor`, pesewas) is append-only; a booking reserves its `balanceAppliedMinor` (available balance = remaining - what open rides and live top-up links hold); rides booked before the change deduct round(price / rides). A top-up is confirmed only by a verified payment whose amount covers `topupMinor`, idempotent per reference; a payment for a lapsed top-up is re-booked only if the pass is still active, the balance still covers its share and no other ride is open, otherwise it is recorded on the ride and a **critical refund alert names the GHS amount**. Cancelling a ride whose top-up was paid raises a refund alert with the amount. The sweeper never expires a pass under a live top-up; low-balance reminder at GHS 80.

## Bookly side (Automation repo)

- [x] **R1. Schema.** RideSettings, RideDestination, Driver, RidePass,
      RidePassEntry (append-only balance log, unique per ride), Ride,
      PaygDay (capacity counter). Student ID and university in
      Customer.attributes.
- [x] **R2. Rides services.** Founding cap with payment holds; package and PAYG
      payment fulfillers (`ride_package`, `ride_payg`); PAYG capacity reserved
      atomically; distance check; ride lifecycle with deduct-on-complete
      exactly once; expiry and reminder sweep.
- [x] **R3. Flow actions** used by the bot: register, founding availability,
      balance, history, account, quote ride, request ride, PAYG open check.
- [x] **R4. The TURBO flow** ("turbo-founding") with their wording, members'
      and newcomers' menus.
- [x] **R5. Notifications**: driver assigned, ride completed with balance,
      package activated, expiry reminders. WhatsApp first, SMS/email fallback.
- [x] **R6. Console API** `/rides/*` (staff login): overview, customers,
      live rides, assign driver, status changes, drivers, destinations,
      packages, payments, capacity and settings. Events: `ride.requested`,
      `ride.assigned`, `ride.completed`, `ride_pass.activated`.
- [x] **R7. App API** `/v1/rides/*` (API key): customer balance and history,
      book a ride, so the TURBO app inherits WhatsApp customers.

## TURBO console (`/root/home/turbo`, Next.js)

- [x] **C1. App shell** in TURBO's brand: lime `#ccf930` on charcoal
      `#0a0d14`, malachite `#00bc59` for success, Space Grotesk headings and
      Karla body, pill buttons, 24–32px cards, grain texture, their logo.
- [x] **C2. Login** with TURBO staff accounts (Bookly users of the TURBO
      organisation), cross-site session with CSRF.
- [x] **C3. Live rides / dispatch**: new requests first, assign driver,
      mark en route / completed / cancelled, live refresh.
- [x] **C4. Customers, packages, payments, capacity** as in their spec §11.
- [x] **C5. Settings**: PAYG open/closed and daily limit, fares, package,
      destinations, drivers.

## Finish

- [x] **E1. End-to-end test** of the whole journey: discover → buy → pay →
      activate → book → assign → complete → balance 59 → history → PAYG.
- [x] **E2. Code and security review**, then deploy notes (Paystack keys,
      WhatsApp number, Arkesel, Gmail, console domain).

## Going live (in this order)

1. **Deploy Bookly** (wave 3 + rides): `git push origin Dev`, back up the
   database, deploy; the migration `20261009090000_rides_pack` runs on start.
2. **Create the TURBO organisation** in the Bookly admin: vertical **RIDES**,
   plan and message quota, owner invite (TURBO's own email).
3. **Connect TURBO's accounts** (organisation settings): their WhatsApp number
   (embedded sign-up), their **Paystack secret key** (start with the TEST key),
   Arkesel API key + sender ID, Gmail address + app password.
4. **Paystack webhook**: in TURBO's Paystack dashboard set the webhook URL to
   `https://<bookly-api>/payments/webhook`. Without it nothing activates.
5. **Install TURBO's bot and settings**: Admin → TURBO's organisation →
   **Bot** panel → **Install TURBO rides bot** → Yes (needs the flows:write
   admin permission; audited). The same installer is still available as
   `scripts/seed-turbo.ts` for local or scripted use.
6. **Console**: push `/root/home/turbo` to its own Git repo, import it into
   Vercel, set `NEXT_PUBLIC_BOOKLY_API_URL=https://<bookly-api>`, add the
   domain (e.g. `console.turboghana.app`). On Bookly set
   `CORS_ORIGINS=<existing>,https://console.turboghana.app` and
   `CROSS_SITE_AUTH=true`, restart.
7. **In the console**: add real destinations (with coordinates) and drivers,
   check package settings (GHS 960 / 60 rides / 60 days / 6 km / 50) and PAYG
   (limit 10, open or closed).
8. **Test with Paystack TEST keys**: message the number "Hi", buy the package
   with a test card / test MoMo, book, assign, complete, check 60 → 59, try
   PAYG. Then swap in the LIVE Paystack key.
9. TURBO connects WhatsApp themselves in the console: **Channels → Connect
   with TURBO's Facebook** (needs step 6's domain added to the Meta app and
   the v4 Embedded Signup config id on Bookly). You see it on the admin
   organisation page → Channels.
10. Optional: a demo console for TURBO before go-live:
   `NEXT_PUBLIC_MOCK=1 TURBO_DEMO_DEPLOY=1` on a separate Vercel project.

Known limits for this MVP: refunds (late or unhonoured payments, ops-cancelled
PAYG) are done by TURBO in their Paystack dashboard, prompted by an alert and
a staff notification; distance is straight line × 1.3, not road routing;
driver messages are SMS only (no driver app).

## Console API contract (R6)

All under `/rides`, authenticated as a TURBO staff user (cookie session,
`X-CSRF-Token` on writes). Amounts in GHS major units as strings.

| Method | Path | Purpose |
|---|---|---|
| GET | `/rides/overview` | Cards: packages sold/activated/remaining slots, `credit {used, remaining}` (GHS), `rides {completed}` (completed package rides), live rides by status, PAYG today (used/limit/open), payments today by status |
| GET | `/rides/live?status=` | Rides not finished (REQUESTED, ASSIGNED, EN_ROUTE), newest first |
| GET | `/rides?from=&to=&status=&kind=&page=` | Ride history |
| POST | `/rides/:id/assign` `{driverId}` | Assign; customer gets driver name, vehicle, plate |
| POST | `/rides/:id/status` `{status: EN_ROUTE\|COMPLETED\|CANCELLED, reason?}` | COMPLETED deducts the package ride's fare (its balanceApplied) exactly once |
| GET | `/rides/customers?search=&page=` | Name, phone, student ID, university, package, balance, expiry |
| GET | `/rides/customers/:id` | Customer with passes, balance log, rides |
| GET | `/rides/passes?status=&page=` | Packages |
| GET | `/rides/payments?kind=&status=&page=` | Package purchases, PAYG rides and package top-ups (kind PACKAGE, purpose PACKAGE_TOPUP) with references |
| GET/POST/PATCH | `/rides/drivers[/:id]` | name, phone, vehicle, plate, active |
| GET/POST/PATCH | `/rides/destinations[/:id]` | label, latitude, longitude, active, sort |
| GET/PATCH | `/rides/settings` | fareRef, package (price, days, cap, holdMinutes, fares, overFare), PAYG (open, dailyLimit, fares, overFare), roadFactor, driverSms, timezone |

Money values are unsigned GHS strings like `"16.00"`, negatives `"-16.00"` (no `+`).

Settings (GET, and the PATCH response):
`{ currency, fareRef: {label, lat, lng} | null, package: { price, days, cap, holdMinutes, fares: [{upToKm, amount}], overFare: string | null, rides, maxKm }, payg: { open, dailyLimit, fares: [{upToKm, amount}], overFare: string | null }, roadFactor, driverSms, timezone }`
(`package.rides` / `package.maxKm` are legacy, kept one release for the console still deployed.)

PATCH body, all optional: `{ fareRef?: {label, lat, lng} | null, package?: { price?, days?, cap?, holdMinutes?, fares?: [{upToKm, amount}], overFare?: number | string | null }, payg?: { open?, dailyLimit?, fares?, overFare? }, roadFactor?, driverSms?, timezone? }`. Amounts in GHS (number or string, at most 2 decimals). `package.rides` / `package.maxKm` are accepted and ignored for one release. An over fare below the last tier's fare is a 400 and nothing is saved.

Ride: `{ id, ref, kind: PACKAGE|PAYG, status, customer: {id, name, phone}, pickup: {label, lat, lng}, destination: {label, lat, lng}, distanceKm, fare, paid, topup, waived, balanceApplied, deducted, balanceAfter, priceDistanceKm, priceBasis: REFERENCE|PICKUP|null, fareBand, driver: {id, name, vehicle, plate} | null, requestedAt, assignedAt, completedAt, cancelledAt, cancelReason }` (money fields string | null; `fare` is the band fare for both kinds, null on package rides from before the change; `fareBand` e.g. "0–6 km", "6–10 km", "Over 10 km").

Pass: `{ id, name, status, customer?, price, credit, used, remaining, ridesTaken, activatedAt, expiresAt, createdAt }` (ridesTotal/ridesUsed/ridesRemaining removed). Customer summary `balance`: GHS string | null. Balance log entry: `{ id, passId, delta (legacy, null on new rows), amount (signed), reason, rideId, rideRef, balanceAfter, createdAt }`. Payment: `{ id, kind: PACKAGE|PAYG, purpose: PACKAGE_PURCHASE|PAYG_RIDE|PACKAGE_TOPUP, status, amount, currency, reference, providerReference, channel, customer, rideRef, passId, createdAt, paidAt }`.

## The user flow TURBO sent

See the original message (6 Oct 2026). Key rules from it: the whole Founding
journey works in WhatsApp without the app; activation only on successful
payment; deduction only on COMPLETED; PAYG is capacity-limited and can be
switched off; the same account and balance carry into the app later.

## Log

| Date | Item | Commit | Notes |
|---|---|---|---|
| 2026-10-06 | flows | cd5cc9c | Payment preparers (reserve before the link), text destinations, opening globals, Paystack transaction ids |
| 2026-10-06 | R1-R5 | 3e86ae3 | Rides pack; Founding 50 = ever sold; anti-squatting from security review; 170 real-DB tests |
| 2026-10-06 | R6, R7 | bd03bbc | Console API + app API; live smoke test 85/85 against the real console client |
| 2026-10-06 | C1-C5 | turbo a80a108 | Console in /root/home/turbo; safe redirects, CSP/HSTS, demo-build guard |
| 2026-10-06 | Inbox | turbo ad96e94, d26a4cf | Customer chats + takeover in the console; hand back to the bot restarts at the menu |
| 2026-10-14 | Fares & credit | feat/turbo-fare-credit | Fare reference point, distance bands with flat over fare, package = GHS credit (deducted at completion), ride_topup + GHS 2 waiver, destination-first flow, GHS copy; migration 20261014090000_rides_credit_pricing |
| 2026-10-06 | Channels | 22bd7df, 4f10b35, turbo f27cef7 | Connect WhatsApp from the console (own Meta account, prefilled; code backup), Instagram & Messenger; admin Channels panel; Embedded Signup v4 |
