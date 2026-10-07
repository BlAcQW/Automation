# Bookly public API v1

Plug an app hosted anywhere (for example TURBO's app) into a Bookly organisation:
Bookly delivers inbound customer messages and events to your URL as signed
webhooks, and your app answers and acts through this API with a scoped key.

- Base URL: `https://<your-api-host>/v1`
- Format: JSON in, JSON out, UTF-8. Send `Content-Type: application/json` on bodies.
- Server to server only. Never put an API key in a browser or mobile app.

## Contents

1. [Authentication](#authentication)
2. [Scopes](#scopes)
3. [Response format, errors, pagination](#response-format)
4. [Rate limits](#rate-limits)
5. [Endpoints](#endpoints)
6. [Webhooks: receiving events](#webhooks)
7. [Event catalogue](#event-catalogue)
8. [The external app flow](#the-external-app-flow)
9. [Payments for your own entities](#payments-for-your-own-entities)
10. [Managing keys and the external app](#managing-keys-and-the-external-app)
11. [Connect WhatsApp from your own app](#connect-whatsapp-from-your-own-app)
12. [Password reset from your own console](#password-reset-from-your-own-console)

---

## Authentication

Send the key as a bearer token:

```
Authorization: Bearer bk_live_AbCdEfGhIj_<48 characters>
```

Keys look like `bk_live_<prefix>_<secret>`. The 10 character prefix is public:
the dashboard shows it so you can tell keys apart and it is stored on messages
you send. The secret is shown **once**, when the key is created, and Bookly
stores only a hash of it. If you lose a key, rotate it (or revoke it and create another).

- A key belongs to one organisation; every request acts as that organisation and
  can only see its data.
- Revoking a key takes effect immediately.
- A key that was rotated keeps working until its `expiresAt`, then stops; after
  that it is treated exactly like a revoked key.
- A bad, unknown, revoked, expired or malformed key always gets the same `401`,
  whatever the reason, so keys cannot be probed.
- If a revoked or expired key is presented with its correct secret, Bookly
  records a security alert for the platform team (once per key per day). If
  you see your integration getting `401` after a rotation, it is still using
  the old key.
- Repeated failed attempts are throttled with `429`, per source address **and** key prefix, so one client sending bad keys does not lock out your valid keys. The address is the real client address (the API trusts the local reverse proxy's `X-Forwarded-For`; see `TRUST_PROXY`).

## Scopes

A key carries only the scopes it was created with. A request that needs a scope
the key lacks gets `403 forbidden`.

| Scope | Allows |
|---|---|
| `messages:write` | `POST /v1/messages` |
| `conversations:read` | `GET /v1/conversations`, `/v1/conversations/:id`, `/v1/conversations/:id/messages` |
| `conversations:write` | `POST /v1/conversations/:id/handoff`, `/resume` |
| `customers:read` | `GET /v1/customers`, `/v1/customers/:id` |
| `customers:write` | `POST /v1/customers`, `PATCH /v1/customers/:id` |
| `payments:write` | `POST /v1/payment-links` |
| `rides:read` | `GET /v1/rides/customers/:id/balance`, `/passes`, `/rides` (RIDES organisations) |
| `rides:write` | `POST /v1/rides` (RIDES organisations) |

There is no scope for reading events: events are pushed to your webhook, and the
catalogue below is public. Keys never expose more than their scopes allow, but
note that **customer endpoints return full contact details** (phone, name, email,
attributes). The staff-side masking in the dashboard does not apply to
tenant-level API keys: treat a key with `customers:read` or `conversations:read`
as holding your customers' personal data.

Give a key the least it needs. A typical external-app key:
`messages:write`, `conversations:read`, `conversations:write`, `customers:read`,
`customers:write`, `payments:write`.

## Response format

Success:

```json
{ "data": { "id": "ckx..." } }
```

Lists add cursor pagination:

```json
{
  "data": [ { "id": "ckx..." } ],
  "pagination": { "nextCursor": "Y2t4Li4u", "hasMore": true }
}
```

Failure:

```json
{ "error": { "code": "window_closed", "message": "The 24-hour customer-service window is closed ..." } }
```

Validation failures (`400`, code `validation_error`) also carry `error.details`:
`[{ "field": "phone", "message": "Must be E.164, e.g. +233241234567" }]`.

### Error codes

| HTTP | `error.code` | Meaning |
|---|---|---|
| 400 | `validation_error` / `bad_request` | The request is malformed. Fix it; do not retry as is. |
| 401 | `unauthorized` | Missing, malformed, unknown, revoked or expired key. |
| 402 | `quota_exceeded` | The organisation's monthly message quota is used up. |
| 403 | `forbidden` | The key lacks the required scope (the message names it). |
| 404 | `not_found` | No such record **in your organisation**. Other organisations' ids look identical. |
| 409 | `conflict` | For example a customer with that phone already exists. |
| 422 | `window_closed` | A free-form message was refused because the 24-hour window is closed. |
| 422 | `channel_not_connected` | The organisation has no connected channel for that conversation. |
| 422 | `payments_not_configured` | The organisation has not connected its own Paystack account. |
| 423 | `outbound_paused` | Bookly support has paused outbound messaging for the organisation. Not a quota problem and not fixed by upgrading; nothing was sent or counted. Retry only after support lifts it. |
| 429 | `rate_limited` | Slow down; see `Retry-After`. |
| 502 | `send_failed` | The channel provider refused or timed out. Nothing was charged to the quota. Safe to retry. |
| 500 | `internal_error` | Our fault. Includes a `requestId` to quote to support. |

### Pagination

`limit` (1-100, default 20) and `cursor`. Pass the previous response's
`pagination.nextCursor` as `cursor` to get the next page; `nextCursor` is `null`
on the last page. Cursors are opaque: do not build or parse them. Lists are
newest first.

### Idempotency

`POST /v1/messages` accepts an optional `Idempotency-Key` header (1-200 of
`A-Z a-z 0-9 _ . : -`). Use a stable key per logical message (for example
`ride-42-pickup-confirmed`) so a retry after a timeout cannot message the
customer twice. Keys are scoped to your organisation (shared by its API keys) and
honoured for **24 hours**.

- Same key, same conversation and text, already sent: the original message is
  returned with `200` and `Idempotent-Replayed: true`; nothing is sent again.
- Same key with a different conversation or text: `409 idempotency_key_reused`.
- Same key while the first request is still being processed: `409
  idempotency_in_progress`. Retry after a moment; it is safe, nothing was sent
  by the rejected request.
- If the message was delivered but could not be recorded, the response is `201`
  with `"recorded": false`. A retry with the same key answers `200` with
  `"recorded": false` and `Idempotent-Replayed: true` and does not send again.
  Limit: that "already sent" marker is kept in Redis when the API has it (shared
  and surviving restarts), otherwise in the memory of one API process. If the
  database write failed **and** the process restarted (or the retry lands on
  another instance without Redis), a retry can send once more.
- After 24 hours the same key sends again.

## Rate limits

- **120 requests per minute per key.** Over the limit you get `429` with
  `Retry-After` (seconds). Other keys are not affected.
- **Failed authentication attempts** are limited per source address and key
  prefix (30 per minute each), plus a coarser flood bound of 300 failures per
  minute per address. A valid key is only affected if its own address-and-prefix
  bucket or the address-wide flood bound is exhausted.
- Message sending is additionally bound by the organisation's plan quota (`402`).

---

## Endpoints

All examples assume `-H "Authorization: Bearer $BOOKLY_KEY"`.

### GET /v1/conversations

Scope `conversations:read`. Query: `state` (`BOT_ACTIVE` or `HUMAN_ACTIVE`),
`customerId`, `limit`, `cursor`.

```bash
curl -H "Authorization: Bearer $BOOKLY_KEY" \
  "https://api.example.com/v1/conversations?state=BOT_ACTIVE&limit=2"
```

```json
{
  "data": [
    {
      "id": "ckconv0001",
      "channel": "WHATSAPP",
      "customerPhone": "+233241234567",
      "customerName": "Ama",
      "customerHandle": null,
      "customerId": "ckcust0001",
      "state": "BOT_ACTIVE",
      "lastInboundAt": "2026-10-06T09:12:00.000Z",
      "windowOpen": true,
      "windowClosesAt": "2026-10-07T09:12:00.000Z",
      "createdAt": "2026-10-01T08:00:00.000Z",
      "updatedAt": "2026-10-06T09:12:05.000Z"
    }
  ],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

`channel` is `WHATSAPP`, `INSTAGRAM` or `MESSENGER`. `windowOpen` is true while
the customer has written within the last 24 hours (see
[POST /v1/messages](#post-v1messages)).

### GET /v1/conversations/:id

Scope `conversations:read`. Returns `{ "data": <conversation> }` as above, or
`404`.

### GET /v1/conversations/:id/messages

Scope `conversations:read`. Newest first, paginated.

```json
{
  "data": [
    {
      "id": "ckmsg0002",
      "conversationId": "ckconv0001",
      "direction": "INBOUND",
      "content": "I need a ride to KNUST at 5pm",
      "messageType": "TEXT",
      "status": null,
      "source": null,
      "createdAt": "2026-10-06T09:12:00.000Z"
    },
    {
      "id": "ckmsg0003",
      "conversationId": "ckconv0001",
      "direction": "OUTBOUND",
      "content": "Booked! Your driver is Kofi.",
      "messageType": "TEXT",
      "status": "DELIVERED",
      "source": "api",
      "createdAt": "2026-10-06T09:13:10.000Z"
    }
  ],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

`source` is `"api"` for messages sent through this API, otherwise `null`.
`status` is the delivery receipt for outbound messages (null until known).

### POST /v1/messages

Scope `messages:write`. Send a text message into an **existing** conversation.

```bash
curl -X POST https://api.example.com/v1/messages \
  -H "Authorization: Bearer $BOOKLY_KEY" \
  -H "Idempotency-Key: ride-42-confirmed" \
  -H "Content-Type: application/json" \
  -d '{ "conversationId": "ckconv0001", "text": "Booked! Your driver is Kofi." }'
```

| Field | Type | Notes |
|---|---|---|
| `conversationId` | string | Required. Must belong to your organisation. |
| `text` | string | Required, 1-4096 characters, not blank. |

`201`:

```json
{
  "data": {
    "id": "ckmsg0003",
    "conversationId": "ckconv0001",
    "direction": "OUTBOUND",
    "content": "Booked! Your driver is Kofi.",
    "messageType": "TEXT",
    "status": null,
    "source": "api",
    "createdAt": "2026-10-06T09:13:10.000Z"
  }
}
```

Rules:

- **24-hour window.** Free-form text can only be delivered within 24 hours of the
  customer's last message. Otherwise: `422 window_closed`, and the message says a
  template is required. Nothing is sent and no quota is used. Check
  `windowOpen` on the conversation if you want to know first. Templates are not
  yet sendable through this API.
- **Quota.** Each sent message takes one slot from the organisation's monthly
  quota, reserved atomically before sending; if the send then fails the slot is
  returned. A full quota is `402 quota_exceeded`.
- The message is stored with `source: "api"` and the key's prefix, so staff can
  see in the inbox that an app sent it.
- Sending does **not** change who handles the conversation. Use handoff/resume
  for that.
- In the rare case the message was delivered but could not be recorded, you get
  `201` with `"recorded": false` and `"id": null`. Do not resend it.

### POST /v1/conversations/:id/handoff

Scope `conversations:write`. Hand the conversation to a person: the assistant
stops replying and staff take over in the inbox.

```bash
curl -X POST https://api.example.com/v1/conversations/ckconv0001/handoff \
  -H "Authorization: Bearer $BOOKLY_KEY" -H "Content-Type: application/json" \
  -d '{ "reason": "Customer asked for a refund" }'
```

Body: optional `reason` (1-200 characters). Response:

```json
{ "data": { "id": "ckconv0001", "state": "HUMAN_ACTIVE", "changed": true } }
```

Idempotent: if a person already has it, `changed` is `false`. Publishes a
`conversation.handoff` event with `to: "HUMAN"` only when the state actually
changed (so does `resume` with `conversation.resumed`); `changed` is `false` and
no event is published if you lost a race with another change.

### POST /v1/conversations/:id/resume

Scope `conversations:write`. Give the conversation back to the assistant. The
takeover fields and the failure count are reset; the assistant's in-flight flow
state is **kept**, so a payment link sent before the handoff still completes its
flow. No body.

```json
{ "data": { "id": "ckconv0001", "state": "BOT_ACTIVE", "changed": true } }
```

Idempotent. Publishes `conversation.resumed`.

### GET /v1/customers

Scope `customers:read`. Query: `phone` (exact, E.164), `limit`, `cursor`.

```json
{
  "data": [
    {
      "id": "ckcust0001",
      "phone": "+233241234567",
      "name": "Ama",
      "email": "ama@example.com",
      "attributes": { "studentId": "S1", "university": "KNUST" },
      "createdAt": "2026-10-01T08:00:00.000Z",
      "updatedAt": "2026-10-05T10:00:00.000Z"
    }
  ],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

### GET /v1/customers/:id

Scope `customers:read`. `{ "data": <customer> }` or `404`.

### POST /v1/customers

Scope `customers:write`.

| Field | Type | Notes |
|---|---|---|
| `phone` | string | Required. Strict E.164: `+` then 8-15 digits, no spaces or dashes. Unique per organisation. |
| `name` | string | Optional, 1-120 characters. |
| `email` | string | Optional, valid email. |
| `attributes` | object | Optional free-form JSON object, at most **4096 bytes** serialised. |

`201` with `{ "data": <customer> }`. `409 conflict` if the phone already exists.
Unknown fields are rejected (`400`) rather than silently ignored.

### PATCH /v1/customers/:id

Scope `customers:write`. Send any of `name`, `email`, `attributes`; `null` clears
a field. **`attributes` is replaced as a whole**, not merged: read, modify and
send the full object. `phone` cannot be changed (it identifies the customer).
`200` with the updated customer, `404` if not yours.

### POST /v1/payment-links

Scope `payments:write`. See [Payments for your own entities](#payments-for-your-own-entities).

| Field | Type | Notes |
|---|---|---|
| `entityRef` | string | Required. Your own id for what is being paid for (a ride, a pass). 1-100 of `A-Z a-z 0-9 _ . : -`. |
| `amountMinor` | integer | Required. Amount in **minor units** (pesewas, kobo, cents): `2500` is 25.00. Between 1 and 100,000,000. |
| `customerPhone` | string | Required. E.164. |
| `callbackUrl` | string | Optional https URL the customer is returned to after paying. |

The currency is always the organisation's payment currency; you cannot choose it.

```json
{
  "data": {
    "url": "https://checkout.paystack.com/abc123",
    "reference": "bf_f_external_app_ride-42_1759742000000",
    "entityRef": "ride-42",
    "amountMinor": 2500,
    "currency": "GHS"
  }
}
```

Send the customer `url` (for example in a message through `POST /v1/messages`).
`422 payments_not_configured` if the organisation has not connected its own
Paystack account. Payments go to the organisation's own Paystack account, never
through Bookly's.

### Rides (RIDES organisations, e.g. TURBO)

The same customers, packages and balances as the WhatsApp bot, so an app can
take over a customer without migrating anything. Amounts are major-unit strings
(`"960.00"`); `fare` is `null` for package rides (paid with a ride credit).

> **Keep the API key on your server.** A `rides:*` key acts for the whole
> organisation: it can read any customer's balance and trips and book a ride
> for any customer. Never put it in a mobile app or a web page. The TURBO app
> must call its own backend, which signs the customer in, decides which
> `customerId` that person is, and only then calls Bookly with the key.

**GET /v1/rides/customers/:id/balance** (`rides:read`): the current package and
balance.

```json
{ "data": { "customerId": "ck...", "active": true, "purchased": 60, "used": 1, "remaining": 59,
  "expiresAt": "2026-12-05T12:00:00.000Z",
  "package": { "id": "ck...", "status": "ACTIVE", "ridesTotal": 60, "ridesUsed": 1, "ridesRemaining": 59,
    "maxKm": 6, "price": "960.00", "currency": "GHS", "activatedAt": "...", "expiresAt": "...", "createdAt": "..." } } }
```

Package `status` is `ACTIVE`, `EXHAUSTED` (active, no rides left), `EXPIRED` or
`CANCELLED`.

**GET /v1/rides/customers/:id/passes** and **GET /v1/rides/customers/:id/rides**
(`rides:read`): every paid package, and the ride history, newest first, with
cursor pagination. A ride is `{ id, ref, kind (PACKAGE|PAYG), status
(REQUESTED|ASSIGNED|EN_ROUTE|COMPLETED|CANCELLED), pickup, destination,
distanceKm, fare, currency, driver, source (WHATSAPP|APP|CONSOLE), requestedAt,
assignedAt, completedAt, cancelledAt }`.

**POST /v1/rides** (`rides:write`): book a package ride.

| Field | Type | Notes |
|---|---|---|
| `customerId` | string | Required. |
| `pickup` | `{ label, lat, lng }` | Required. |
| `destination` | `{ label, lat, lng }` | Exactly one of `destination` / `destinationId`. |
| `destinationId` | string | One of the organisation's saved places. |

`201 { data: ride }`. The same rules as WhatsApp apply: `409 no_package`,
`409 no_rides_left`, `409 open_ride` (one ride in progress at a time),
`422 too_far` (beyond the package distance). A retried request for the same
trip while that ride is still waiting returns the same ride with `200`. A ride
is deducted from the balance only when TURBO marks it completed.

---

## Webhooks

Bookly POSTs events to your URL (the external app URL, or any webhook the owner
configures). Respond with any `2xx` within **10 seconds** to acknowledge.

### Delivery

```
POST https://your-app.example/hooks/bookly
Content-Type: application/json
X-Bookly-Event: message.received
X-Bookly-Delivery: <delivery id>
X-Bookly-Signature: t=1759742000,v1=5b1f...c0de
```

```json
{
  "id": "ckevt0001",
  "type": "message.received",
  "tenantId": "cktenant1",
  "createdAt": "2026-10-06T09:12:00.000Z",
  "data": {
    "v": 1,
    "conversationId": "ckconv0001",
    "messageId": "ckmsg0002",
    "channel": "WHATSAPP",
    "customerId": "ckcust0001",
    "text": "I need a ride to campus",
    "type": "TEXT"
  }
}
```

- Delivery is **at least once**. Retries back off from 30 seconds up to 3 hours
  for up to 8 attempts after a non-2xx or a timeout. **Deduplicate on the event
  `id`** (also in `X-Bookly-Delivery`) and make your handler idempotent.
- Order is not guaranteed across events.
- Every `data` object has `v`, the payload schema version. Additive changes keep
  `v`; a breaking change bumps it and the old version is published alongside it
  for a deprecation window.
- Your URL must be public `https` (plain `http` is accepted only when the API
  runs with `NODE_ENV` explicitly `development` or `test`). Addresses on private
  networks, loopback, cloud metadata, and transition ranges (Teredo, 6to4 relay,
  NAT64 local-use, discard-only) are refused, checked again at every delivery.
- **Fairness.** At most 3 deliveries per organisation are in flight at once.
  Extra deliveries wait a few seconds and are retried; none are dropped. A slow
  endpoint therefore delays your own events, not other organisations'.

### What is stored

High-volume events (`message.received`, `message.sent`, `customer.*`,
`booking.*`, `order.created`, `conversation.*`) are **only recorded when at least
one active subscription of the organisation matches the event type** (the
external app counts). With no matching subscriber nothing is stored, including
the message text and contact details those events carry. Money and flow events
(`payment.*`, `flow.completed`) are always recorded: they double as idempotency
records. Recorded events and delivery history are kept for 30 days.

`payment.succeeded`, `payment.failed` and the retried-turn `message.received`
are published **once per reference** (a unique key per organisation and event, no
payload scanning), so a redelivered charge never produces a second event.

The webhook created for your external app is managed only through
`/developer/external-app`: it does not appear in the owner's webhook list, does
not count toward the 10-webhook limit, and cannot be edited, rotated or deleted
there. The description `external-app` is reserved.

`payment.succeeded` is a fact about the **charge**, not about fulfilment: it says
Paystack confirmed money for `reference`. It can fire for a payment that was not
fulfilled (a booking whose hold had already expired, or a flow payment the
conversation was no longer waiting for), and those payments need a refund or a
rebooking by a person. Do not treat the event as proof the customer received
what they paid for; check your own state for `reference` before delivering
anything, and expect the event to be recorded late (never twice) if an outage
delayed it.

### Verifying the signature

`X-Bookly-Signature` is `t=<unix seconds>,v1=<hex>` where
`v1 = HMAC-SHA256(signingSecret, "<t>.<raw request body>")`.

Always verify against the **raw bytes** you received (not re-serialised JSON),
compare in constant time, and reject timestamps more than 5 minutes old to stop
replays.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyBookly(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

```python
import hmac, hashlib, time

def verify_bookly(raw_body: bytes, header: str, secret: str, tolerance=300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts["t"])
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

Express: use `express.raw({ type: 'application/json' })` on this route so you
receive the untouched body, then `JSON.parse` after verifying.

The signing secret starts with `whsec_`. It is shown once when the external app
is created and again only if you rotate it.

---

## Event catalogue

The authoritative, always-current list is served by the dashboard API
(`GET /webhooks/event-types`) and defined in
`apps/api/src/services/events/catalogue.ts`. Current events:

| Event | `data` fields (besides `v`) |
|---|---|
| `message.received` | `conversationId`, `messageId`, `channel`, `customerId`, `text`, `type` |
| `message.sent` | `conversationId`, `messageId`, `channel`, `sentBy` (`AI`, `HUMAN`, `FLOW`, `APP`) |
| `conversation.handoff` | `conversationId`, `to` (`HUMAN` or `APP`), `reason` |
| `conversation.resumed` | `conversationId` |
| `customer.created` | `customerId` |
| `customer.updated` | `customerId`, `changed` (field names) |
| `payment.succeeded` | `paymentId`, `amount` (minor units), `currency`, `reference` |
| `payment.failed` | `paymentId`, `amount` (minor units), `currency`, `reference`, `reason` (for example `underpaid`) |
| `booking.created` | `bookingId`, `customerId`, `startsAt` |
| `booking.cancelled` | `bookingId`, `reason` |
| `booking.completed` | `bookingId` |
| `order.created` | `orderId`, `customerId`, `total`, `currency` |
| `flow.completed` | `flowKey`, `version`, `conversationId`, `customerId`, `vars` (see below) |
| `ride.requested` | `rideId`, `ref`, `kind`, `customerId`, `distanceKm`, `fare` (minor units), `currency`, `source` |
| `ride.assigned` | `rideId`, `ref`, `kind`, `customerId`, `driverId` |
| `ride.completed` | `rideId`, `ref`, `kind`, `customerId`, `passId`, `ridesRemaining` |
| `ride_pass.activated` | `passId`, `customerId`, `rides`, `expiresAt`, `reference` |

`flow.completed.vars` holds only what the flow definition declares shareable:
values set by menu choices, a choose step's value, label and attributes, and
anything listed in the step's `produces`. It never contains free-text answers
(names, emails, ids typed into `ask` steps), locations, payment URLs or
references, or the customer's phone number; read the customer by `customerId`
if you need those.

The external app subscription carries: `message.received`,
`conversation.handoff`, `conversation.resumed`, `payment.succeeded`,
`payment.failed`, `flow.completed`.

`message.received` carries the message itself, so no extra API call is needed to
read it:

- `text` is the message text. For other message types it is the caption, the
  tapped button or list row id, or the place name or contact name, and `""` when
  there is none.
- `type` is `TEXT`, `INTERACTIVE`, `LOCATION`, `CONTACT`, `REACTION`, `IMAGE`,
  `VIDEO`, `AUDIO`, `STICKER` or `DOCUMENT`. For an attachment this is its media
  type; the file itself is not in the event.
- `customerId` is the customer record the conversation is linked to, or `null`
  while no customer exists for it (for example an Instagram sender who has not
  given a phone number yet).

`GET /v1/conversations/:id/messages` still returns the full history and the
coordinates of a location message.

Bookly publishes `message.received` for every inbound message of every business,
whether or not an app is connected. For a business whose conversations belong to
an app, Bookly sends no reply of its own and delivery of this event is what hands
the message over; a message whose event could not be recorded is retried, not
dropped.

`payment.succeeded` for a payment link made through `POST /v1/payment-links`
carries these fields (a superset of the catalogue's):

```json
{
  "v": 1,
  "entityRef": "ride-42",
  "amountMinor": 2500,
  "currency": "GHS",
  "reference": "bf_f_external_app_ride-42_1759742000000",
  "paymentId": "bf_f_external_app_ride-42_1759742000000",
  "amount": 2500
}
```

Events you cause yourself through the API (a handoff, a sent message, a customer
change) are published too, so other subscribers see them. If your own app is
subscribed to `conversation.handoff` / `conversation.resumed` it will receive
the echo of its own call; ignore events you caused.

---

## The external app flow

1. **Set up.** The organisation owner creates an API key and registers the app
   (name, `https` URL) in developer settings. Bookly shows the key and the
   signing secret once; store both as secrets in your app.
2. **A customer writes.** Bookly receives the WhatsApp message and delivers a
   signed `message.received` event to your URL, with the text in `data.text`.
3. **Verify and acknowledge.** Verify the signature, dedupe on the event `id`,
   reply `200` quickly and do the work asynchronously.
4. **Read the message.** The text is in `data.text`. Use `GET /v1/customers?phone=...` / `POST /v1/customers` to find
   or create the customer record and keep your own fields in `attributes`.
5. **Reply.** `POST /v1/messages` with the `conversationId` and your text. Send
   an `Idempotency-Key` so retries are safe. If the 24-hour window is closed you
   get `422 window_closed`.
6. **Take payment (optional).** `POST /v1/payment-links`, send the `url` to the
   customer, and wait for `payment.succeeded` with your `entityRef`.
7. **Hand over.** `POST /v1/conversations/{id}/handoff` when a person should
   take it; `POST .../resume` to give it back to the assistant.

---

## Payments for your own entities

`POST /v1/payment-links` creates a Paystack checkout on the **organisation's own
Paystack account** for something your app owns (a ride, a pass). When the
customer pays:

1. Paystack notifies Bookly; Bookly verifies the signature and re-verifies the
   transaction with Paystack, taking the amount and currency from Paystack.
2. Bookly checks that the charge's recorded kind, `entityRef` and organisation
   match, then publishes **one** `payment.succeeded` event per Paystack
   `reference` (redeliveries do not produce duplicates).

Bookly does not store what you intended to charge for your entity, because your
app owns that. **Compare `amountMinor` and `currency` in `payment.succeeded`
with what you expected for `entityRef` before you fulfil it.** Treat the event as
"this much was paid for this reference", not as "your order is paid in full".
The same `entityRef` can have several links; each has its own `reference`.

---

## Managing keys and the external app

These are dashboard endpoints (login token, **owner only**), not API-key
endpoints. Responses use `{ "data": ... }`.

| Method and path | Purpose |
|---|---|
| `GET /developer/scopes` | Scopes you can grant, with descriptions. |
| `GET /developer/api-keys` | List keys: `id`, `name`, `prefix`, `scopes`, `lastUsedAt`, `revokedAt`, `expiresAt`, `rotatedFromId`, `createdAt`, and `status` (`active`, `expiring` = in a rotation grace period, `expired`, `revoked`). Never the key. |
| `POST /developer/api-keys` | Body `{ "name", "scopes": [...] }`. Returns `{ "data": { "key": "bk_live_...", "apiKey": {...} } }`. **The full key appears only here.** At most 20 active keys per organisation (`409` beyond); keys in a grace period do not count. |
| `POST /developer/api-keys/:id/rotate` | Body `{ "graceHours"?: 0-168 }` (default `24`). Creates a replacement with the same name and scopes and returns `{ "data": { "key", "apiKey", "previous": { "id", "prefix", "expiresAt", "revokedAt" } } }` (`201`). **The new key appears only here.** The old key keeps working until `previous.expiresAt`; `graceHours: 0` revokes it at once. Only an `active` key can be rotated (`409` for a revoked, expired or already rotating key; `404` for an unknown one). At most 40 keys may be working at once, counting keys in a grace period (`409` beyond). |
| `DELETE /developer/api-keys/:id` | Revoke. Immediate and idempotent. Also ends a grace period early. |
| `GET /developer/external-app` | `{ name, url, isActive, createdAt, updatedAt }` or `null`. Never the secret. |
| `PUT /developer/external-app` | Body `{ "name", "url", "isActive"? }`. Creates or updates. On creation the response includes `signingSecret` (shown once). |
| `POST /developer/external-app/rotate-secret` | New `signingSecret`, returned once. The old one stops working at once; update your app first or accept a gap. |
| `DELETE /developer/external-app` | Remove the app and stop delivery. |

`lastUsedAt` is approximate: it is updated at most once a minute per key.

### Rotating a key without downtime

1. `POST /developer/api-keys/:id/rotate` with a grace period long enough to
   deploy everywhere (default 24 hours, up to 7 days). Store the returned `key`.
2. Deploy the new key to every system that used the old one.
3. Watch the old key's `lastUsedAt` in `GET /developer/api-keys` (or the
   dashboard: Settings > Developer). Once it stops moving, everything has
   switched over.
4. Let the old key expire on its own, or `DELETE` it to end the grace period
   early.

If a key leaked, do not wait: rotate with `graceHours: 0` (or revoke it).

Platform support can also revoke an organisation's keys (for example after a
leak); the owner gets an in-app notification with the reason.

Saving the external app maintains one managed webhook subscription (description
`external-app`) with the same URL and secret, carrying the events listed above.
Setting `isActive: false` or deleting the app switches delivery off; the
subscription row and its delivery history are kept. It counts toward the
organisation's webhook limit.

---

## Connect WhatsApp from your own app

An organisation with its own console (for example TURBO's, on its own domain)
can connect its WhatsApp number **through Bookly's API**, without opening the
Bookly dashboard. These are dashboard endpoints, not `/v1` API-key endpoints:
call them from the browser with the staff member's **Bookly login** (`Authorization:
Bearer <access token>`, refreshed through `/auth/refresh` with the refresh cookie).
Your console's origin must be in the API's `CORS_ORIGINS`, with
`CROSS_SITE_AUTH=true` so the refresh cookie works cross-site.

Two ways to connect:

| | **Own Meta account (primary)** | **Bookly-hosted number (backup)** |
|---|---|---|
| How | Meta's Embedded Signup popup (v4) in your console | Type the number, enter the OTP Meta sends |
| WhatsApp Business Account | The organisation's own | Bookly's |
| Who Meta bills | The organisation (it adds a payment method in Meta) | **Bookly's WABA**; Bookly bills the organisation |
| `mode` | `OWN_ACCOUNT` | `BOOKLY_HOSTED` |
| Availability | `embeddedSignupAvailable` in status | `hostedAvailable` in status (off until Bookly sets `PLATFORM_WABA_ID` + `PLATFORM_WHATSAPP_TOKEN`) |

Either way, inbound messages are routed to the organisation by the number's
`phone_number_id`, and every outbound message counts against **that
organisation's** plan quota and obeys its pause switches. A hosted number is not
shared: it belongs to exactly one organisation.

**Roles.** Any signed-in user can read the status. Only the **OWNER** can
connect or disconnect (`403 OWNER_ONLY` otherwise).

### Errors

Failures return `{ "statusCode", "error", "code", "message" }`. Branch on `code`;
`message` is human copy for the owner and may change.

| `code` | Status | Meaning |
|---|---|---|
| `OWNER_ONLY` | 403 | Signed-in user is not the owner. |
| `HOSTED_NOT_AVAILABLE` | 503 | Bookly-hosted numbers are switched off on this server. Offer Embedded Signup. |
| `HOSTED_CAPACITY_FULL` | 503 | Bookly's WABA is at Meta's 20-number cap. |
| `EMBEDDED_SIGNUP_NOT_AVAILABLE` | 503 | The Meta app is not configured on this server. |
| `ALREADY_CONNECTED` | 409 | A live number is connected; disconnect first. |
| `NUMBER_IN_USE` | 409 | That number is connected to another Bookly organisation. |
| `NUMBER_ALREADY_ON_WHATSAPP` | 409 | The number has a WhatsApp / WhatsApp Business app account; delete it on the phone first. |
| `INVALID_NUMBER` | 400 | The number does not look right. |
| `NO_PENDING_VERIFICATION` | 409 | No hosted number is waiting for a code. |
| `INVALID_OTP` | 400 | Wrong or missing code. |
| `TOO_MANY_ATTEMPTS` | 429 | Our rate limit or Meta's; wait (see `Retry-After` when present). |
| `RESEND_TOO_SOON` | 429 | A code was sent under 60 seconds ago; `Retry-After` says how long to wait. |
| `CODE_SEND_FAILED` | 502 | Meta could not deliver the code; try `VOICE`. |
| `TWO_STEP_PIN_LOCKED` | 409 | Embedded Signup: the number already has a two-step verification PIN and Meta would not let Bookly reset it. The owner turns it off in WhatsApp Manager (Phone numbers > the number > Settings > Two-step verification > Turn off), then connects again. |
| `META_ERROR` | 502 | Meta refused a step; start again. |
| `NOT_CONNECTED` | 409 | (admin actions) nothing to act on. |
| `MANUAL_CREDENTIALS_INVALID` | 400 | Manual connect: the token is not Bookly's app's, or the number is not on that account (or is a Bookly-hosted number). |
| `COUNTRY_NOT_SUPPORTED` | 400 | Hosted numbers are not offered in that country (default allowlist: Ghana, +233). |
| `EMAIL_NOT_VERIFIED` | 403 | The owner must verify their email before starting a hosted number. |
| `DESTINATION_LIMIT` | 429 | Too many codes sent to that phone number in 24 hours. |
| `HOSTED_BUSY` | 429 | Platform-wide hourly cap on hosted codes reached; try later. |
| `START_IN_PROGRESS` | 409 | Another hosted start for this organisation is running. |

Validation failures are `400` with `fields` (no `code`).

### `GET /whatsapp/status`

```json
{
  "connected": true,
  "state": "CONNECTED",
  "mode": "OWN_ACCOUNT",
  "phoneNumberId": "1234567890",
  "displayNumber": "+233 30 000 0000",
  "displayPhoneNumber": "+233 30 000 0000",
  "verifiedName": "TURBO Rides",
  "nameStatus": "APPROVED",
  "hosted": false,
  "numberStatus": null,
  "awaitingCode": false,
  "connectedAt": "2026-10-06T09:00:00.000Z",
  "billedBy": "ORGANISATION",
  "pending": null,
  "health": {
    "qualityRating": "GREEN",
    "messagingLimit": "TIER_1K",
    "metaStatus": "CONNECTED",
    "problem": null,
    "checkedAt": "2026-10-06T12:00:00.000Z",
    "tokenExpiresAt": null
  },
  "hostedAvailable": false,
  "hostedUnavailableReason": "NOT_CONFIGURED",
  "embeddedSignupAvailable": true,
  "canManage": true
}
```

- `state`: `NOT_CONNECTED` | `PENDING_CODE` (hosted, OTP sent) | `REGISTERING`
  (hosted, code accepted, registration not finished: call verify again with no
  code) | `CONNECTED` | `PROBLEM` (connected, but the last health check found a
  problem; see `health.problem`).
- `mode`: `OWN_ACCOUNT` | `BOOKLY_HOSTED` | `MANUAL` | `null`.
- `billedBy`: `ORGANISATION` (Meta bills the organisation) | `BOOKLY` (hosted) | `null`.
- `pending` (hosted, before it is live): `{ "step": "CODE_SENT" | "CODE_VERIFIED",
  "displayNumber", "codeMethod": "SMS" | "VOICE", "codeSentAt", "resendAvailableAt" }`.
- `health.problem`: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `APP_UNSUBSCRIBED`,
  `NUMBER_NOT_FOUND`, `NUMBER_BANNED`, `NUMBER_RESTRICTED`, `NUMBER_FLAGGED`,
  `NUMBER_DISCONNECTED`, `NUMBER_DELETED`, `PLATFORM_TOKEN_MISSING`, or `null`.
  Refreshed about every 6 hours.
- `hostedUnavailableReason`: `NOT_CONFIGURED` or `null`.

Facebook Messenger and Instagram status for the same organisation:
`GET /channels/status` returns
`{ whatsapp: { connected, label, awaitingCode, mode, connectedAt, billedByMeta },
messenger: { connected, label, pageName, connectedAt, billedByMeta },
instagram: { connected, label, username, connectedAt, requiresPage, billedByMeta } }`.

### Own Meta account: Embedded Signup v4

**1. Get the launch options.** `GET /whatsapp/embedded-signup/config` (owner):

```json
{
  "available": true,
  "unavailableReason": null,
  "appId": "1234567890",
  "configId": "9876543210",
  "sdkVersion": "v25.0",
  "login": {
    "config_id": "9876543210",
    "response_type": "code",
    "override_default_response_type": true,
    "extras": {
      "setup": {
        "business": { "name": "TURBO Rides", "email": "owner@turbo.example", "address": { "country": "GH" }, "timezone": "UTC+00:00" },
        "phone": { "displayName": "TURBO Rides", "category": "TRAVEL", "description": "" }
      }
    }
  },
  "sessionEvent": {
    "origins": ["https://www.facebook.com", "https://web.facebook.com", "https://business.facebook.com"],
    "type": "WA_EMBEDDED_SIGNUP"
  },
  "completePath": "/whatsapp/embedded-signup"
}
```

`appId` and `configId` are public values; the app secret never leaves Bookly.
`sessionEvent.origins` is the exact list of origins the popup posts from:
accept a `message` event only if `event.origin` is **exactly** one of them
(set membership; suffix checks such as `endsWith('facebook.com')` would also
accept `evilfacebook.com`).
`setup` prefills Meta's screens from what Bookly knows (fields it does not know
are omitted; `category` is `TRAVEL` for rides, `RETAIL` for product shops,
`PROF_SERVICES` otherwise). You may merge your own values into `setup` before
launching. In v4 the **configuration** (`config_id`) decides the version and
products, so do **not** send `extras.version`, `sessionInfoVersion` or
`featureType`.

**2. Launch.** Load `https://connect.facebook.net/en_US/sdk.js`, then:

```js
FB.init({ appId: cfg.appId, cookie: true, xfbml: true, version: cfg.sdkVersion });

let sessionInfo;
window.addEventListener('message', (event) => {
  if (!cfg.sessionEvent.origins.includes(event.origin)) return; // exact match only, never endsWith
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (data.type === cfg.sessionEvent.type) sessionInfo = data; // { type, event, data: { phone_number_id, waba_id, business_id, ... } }
  } catch {}
});

FB.login((response) => {
  const code = response.authResponse?.code;   // valid for about 30 seconds: post it at once
  if (!code) return; // cancelled
  // The message event usually lands first; the dashboard waits ~300 ms in case it does not.
  fetch(`${API}/whatsapp/embedded-signup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, sessionInfo }),
  });
}, cfg.login);
```

**3. Complete.** `POST /whatsapp/embedded-signup` (owner). Body:

```json
{ "code": "AQB...", "sessionInfo": { "type": "WA_EMBEDDED_SIGNUP", "event": "FINISH", "data": { "phone_number_id": "1234567890", "waba_id": "555", "business_id": "777" } } }
```

Also accepted (v2/v3 transition): flat `waba_id` / `phone_number_id` or
`wabaId` / `phoneNumberId`, or just `{ "code" }` (Bookly then takes the first
WABA and number the token can see). `redirectUri` is only for the native-app
WebView flow. A `sessionInfo.event` of `CANCEL` is refused with `META_ERROR`.

Bookly exchanges the code for the business token (stored encrypted, never
returned) and inspects it (mandatory, fails closed): it must be valid and issued
to Bookly's app. The WABA must be one the token was granted
(`whatsapp_business_management` / `whatsapp_business_messaging` targets) and
the number must be on that WABA. If the token was granted several WABAs, or the
WABA has several numbers, the session's `waba_id` / `phone_number_id` are
required: Bookly never guesses "the first one". It then subscribes its app to
the WABA and registers the number for Cloud API with a random per-number PIN
(stored encrypted). If the number already has a two-step verification PIN (Meta
error `#133005`, "Two step verification PIN Mismatch"), Bookly sets the number's
two-step code to its new PIN with the business token (`POST /{phone_number_id}`,
form `pin`) and registers once more; if Meta refuses that, or the retry still
mismatches, the answer is `TWO_STEP_PIN_LOCKED`. Response:

```json
{ "success": true, "mode": "OWN_ACCOUNT", "displayNumber": "+233 30 000 0000", "verifiedName": "TURBO Rides", "connectedAt": "2026-10-06T09:00:00.000Z", "status": { "...": "same shape as GET /whatsapp/status" } }
```

Errors: `META_ERROR`, `TWO_STEP_PIN_LOCKED`, `NUMBER_IN_USE`, `ALREADY_CONNECTED` (a live Bookly-hosted
number exists; a hosted number still waiting for its code is replaced),
`EMBEDDED_SIGNUP_NOT_AVAILABLE`, `TOO_MANY_ATTEMPTS` (10 per minute).

Afterwards the organisation must add a payment method to its WhatsApp Business
Account in Meta (Meta bills it directly).

### Bookly-hosted number (backup)

Check `hostedAvailable` first; when `false` every hosted call answers
`503 HOSTED_NOT_AVAILABLE`. Guard rails, because Meta bills Bookly for these:

- the owner's email must be verified (`EMAIL_NOT_VERIFIED`);
- only allowlisted countries (`HOSTED_WHATSAPP_COUNTRIES`, default `233`; `COUNTRY_NOT_SUPPORTED`);
- at most 5 codes (start + resend) per destination number per 24 hours
  (`DESTINATION_LIMIT`) and 30 platform-wide per hour (`HOSTED_BUSY`);
- one start at a time per organisation (`START_IN_PROGRESS`);
- if Meta cannot report how many hosted slots are used, start is refused (`META_ERROR`);
- a number not verified within **30 minutes** of its last code is released
  (removed from Bookly's WABA, status back to `NOT_CONNECTED`, owner notified).

**`POST /whatsapp/hosted/start`** (owner; 5 per 10 minutes)

```json
{ "countryCode": "233", "localNumber": "024 123 4567", "codeMethod": "SMS", "displayName": "TURBO Rides" }
```

`codeMethod`: `SMS` (default) or `VOICE`. `displayName` (3-100 chars) is the
business name customers see; it defaults to the organisation name and Meta
reviews it (its approval shows as `nameStatus` in status once checked). The
leading trunk `0` is stripped. Calling `start` again while a number is still
waiting for its code replaces that number. Response:

```json
{ "success": true, "status": "PENDING_CODE", "step": "CODE_SENT", "displayNumber": "+233241234567", "verifiedName": "TURBO Rides", "codeMethod": "SMS", "codeSentAt": "2026-10-06T09:00:00.000Z", "resendAvailableAt": "2026-10-06T09:01:00.000Z" }
```

Errors: `ALREADY_CONNECTED`, `START_IN_PROGRESS`, `HOSTED_CAPACITY_FULL`, `INVALID_NUMBER`,
`COUNTRY_NOT_SUPPORTED`, `EMAIL_NOT_VERIFIED`, `DESTINATION_LIMIT`, `HOSTED_BUSY`,
`NUMBER_ALREADY_ON_WHATSAPP`, `CODE_SEND_FAILED`, `TOO_MANY_ATTEMPTS`, `META_ERROR`.

**`POST /whatsapp/hosted/resend`** (owner; 3 per 10 minutes, and not within 60 s of the last code)

```json
{ "codeMethod": "VOICE" }
```

Response: `{ "success": true, "codeMethod": "VOICE", "codeSentAt": "...", "resendAvailableAt": "..." }`.
Errors: `NO_PENDING_VERIFICATION`, `RESEND_TOO_SOON` (with `Retry-After`),
`DESTINATION_LIMIT`, `HOSTED_BUSY`, `CODE_SEND_FAILED`, `TOO_MANY_ATTEMPTS`.

**`POST /whatsapp/hosted/verify`** (owner; 6 per 10 minutes)

```json
{ "code": "123456" }
```

Response: `{ "success": true, "status": "REGISTERED", "mode": "BOOKLY_HOSTED", "displayNumber": "+233241234567", "verifiedName": "TURBO Rides", "connectedAt": "..." }`.
If the code was accepted but registration with Meta failed, you get
`META_ERROR` and `state` becomes `REGISTERING`; call verify again **without** a
code. Errors: `INVALID_OTP`, `NO_PENDING_VERIFICATION`, `TOO_MANY_ATTEMPTS`, `META_ERROR`.

### `POST /whatsapp/connect` (manual fallback)

Owner, 5 per 10 minutes. Body `{ "phoneNumberId", "accountId", "accessToken", "displayNumber"? }`.
Before anything is stored Bookly verifies with Meta that the token is valid and
issued to Bookly's app, that (when the token lists WABAs) `accountId` is one of
them, that `phoneNumberId` is on `accountId`, and that neither is Bookly's own
WABA or a Bookly-hosted number; otherwise `400 MANUAL_CREDENTIALS_INVALID`.
Response `{ "success": true, "mode": "MANUAL", "displayNumber" }`.

### `POST /whatsapp/disconnect`

Owner. No body. Response `{ "success": true, "wasConnected": true }`. Works for
a live number and for a hosted number still waiting for its code. A hosted
number is removed from Bookly's WABA; for an own account Bookly unsubscribes its
app from the organisation's WABA (unless another Bookly organisation uses the
same WABA). Meta-side failures never block the disconnect.

### Meta app setup for an external console

Embedded Signup runs in your console's browser page, so Meta must trust its domain:

1. Meta app dashboard -> **Facebook Login for Business -> Settings**: add the
   console's domain (for example `console.turbo.example`) to **Allowed domains
   for the JavaScript SDK**, and its `https://` URL to **Valid OAuth redirect
   URIs**. Keep "Login with the JavaScript SDK" on.
2. The app ID and the Embedded Signup **configuration ID** are public. The
   console reads them from `GET /whatsapp/embedded-signup/config` (or its own
   `NEXT_PUBLIC_WHATSAPP_APP_ID` / `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`). Set
   `WHATSAPP_CONFIG_ID` on the Bookly API so the config endpoint can hand it out.
3. The configuration must be a **v4** Embedded Signup configuration (Facebook
   Login for Business -> Configurations -> WhatsApp Embedded Signup, with the
   WhatsApp Cloud API product selected). v2/v3 stop working on 15 October 2026.

---

## Password reset from your own console

Organisation users sign in to your console with their Bookly login, so a
"Forgot password?" link in your console uses Bookly's endpoints. These are
dashboard endpoints (no API key, no login), called from the browser.

### `POST /auth/forgot-password`

Body `{ "email": "kofi@example.com", "resetUrl"?: "https://console.turbo.example/reset-password" }`.
Always `200 { "success": true }`, whether or not the address has an account.
Rate limit: 5 per 15 minutes per client address.

If the address belongs to an active user, Bookly emails a link that works
**once, for one hour**. The link is `resetUrl` with `?token=<token>` set on it
(any query string or fragment you sent is dropped), or Bookly's own
`<FRONTEND_URL>/reset-password?token=...` when `resetUrl` is missing or not
allowed. `resetUrl` is used only when:

- it parses as an absolute URL with no user name or password in it;
- it is `https` (plain `http` only for `localhost` when the API runs in
  development or test);
- its origin (scheme, host and port) is **exactly** one of the API's allowed
  origins: `FRONTEND_URL` plus `CORS_ORIGINS`. Lookalike hosts, subdomains and
  other ports do not match.

Otherwise it is ignored silently: no error, same answer, Bookly link in the
email. Your console's origin must therefore be in `CORS_ORIGINS` (it already is
if your console calls the API from the browser).

### `POST /auth/reset-password`

Your reset page reads `token` from its own URL and sends
`{ "token": "<token>", "password": "<at least 8 characters>" }`.
`200 { "success": true }`, or `400` "This reset link is invalid or has expired"
(already used, older than an hour, or the password changed since). Rate limit:
10 per 15 minutes. Then send the user to your sign-in page.

### Platform admin: helping a user back in

Bookly's admin console (organisation page, **People** panel) can do the same on
a user's behalf. Admins never see or set the password. Admin token only: an
organisation login or a support-session token gets `401`.

| Method and path | Permission | Request | Response |
|---|---|---|---|
| `POST /admin/tenants/:id/users/:userId/password-reset/email` | `users:write` (OWNER, SUPPORT) | no body | `200 { "success": true, "email": "<user email>" }`. Sends the standard reset email with the **Bookly** link. `503` with `code: "RESET_EMAIL_NOT_SENT"` if the email could not be sent (nothing audited). |
| `POST /admin/tenants/:id/users/:userId/password-reset/link` | `users:reset_link` (OWNER only) | `{ "resetUrl"?: string }` (no other fields) | `200 { "link": "https://.../reset-password?token=...", "expiresAt": "<ISO, 1 hour>" }`, `Cache-Control: no-store`. Nothing is emailed. A `resetUrl` is checked by the same rule as above, but an admin gets `400` instead of a silent fallback. |
| `GET /admin/password-reset/link-options` | `users:reset_link` | | `200 { "data": [{ "label", "origin", "resetUrl", "isDefault" }] }`: Bookly first, then `<origin>/reset-password` for each other allowed https origin. The admin UI offers these in a select and preselects the first console for `RIDES` organisations. |

Both POSTs: `404` if the user is not in that organisation, `409` if the user or
the organisation is deactivated, rate limit 5 per 10 minutes per admin per user.
They are audited as `auth.password_reset.admin_sent` and
`auth.password_reset.admin_link_created` (actor: the admin; target: the user;
for the link only the origin it points at is recorded, never the link or token).
A copied link is shown once in the admin's browser and is not stored anywhere.
Every token issued for a user stops working the moment their password changes.
