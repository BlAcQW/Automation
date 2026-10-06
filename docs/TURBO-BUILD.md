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
5. **Install TURBO's flow and settings** (run by you, against production,
   dry run first): `cd apps/api && DATABASE_URL=<prod> npx tsx
   scripts/seed-turbo.ts --tenant <turbo-tenant-id>` then the same with `--yes`.
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
9. Optional: a demo console for TURBO before go-live:
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
| GET | `/rides/overview` | Cards: packages sold/activated/remaining slots, rides used/remaining, live rides by status, PAYG today (used/limit/open), payments today by status |
| GET | `/rides/live?status=` | Rides not finished (REQUESTED, ASSIGNED, EN_ROUTE), newest first |
| GET | `/rides?from=&to=&status=&kind=&page=` | Ride history |
| POST | `/rides/:id/assign` `{driverId}` | Assign; customer gets driver name, vehicle, plate |
| POST | `/rides/:id/status` `{status: EN_ROUTE\|COMPLETED\|CANCELLED, reason?}` | COMPLETED deducts one package ride exactly once |
| GET | `/rides/customers?search=&page=` | Name, phone, student ID, university, package, balance, expiry |
| GET | `/rides/customers/:id` | Customer with passes, balance log, rides |
| GET | `/rides/passes?status=&page=` | Packages |
| GET | `/rides/payments?kind=&status=&page=` | Package and PAYG payments with references |
| GET/POST/PATCH | `/rides/drivers[/:id]` | name, phone, vehicle, plate, active |
| GET/POST/PATCH | `/rides/destinations[/:id]` | label, latitude, longitude, active, sort |
| GET/PATCH | `/rides/settings` | package (price, rides, days, maxKm, cap), PAYG (open, dailyLimit, fares), roadFactor, driverSms |

Ride: `{ id, ref, kind: PACKAGE|PAYG, status, customer: {id, name, phone}, pickup: {label, lat, lng}, destination: {label, lat, lng}, distanceKm, fare, driver: {id, name, vehicle, plate} | null, requestedAt, assignedAt, completedAt }`

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
