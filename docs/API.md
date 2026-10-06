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

---

## Authentication

Send the key as a bearer token:

```
Authorization: Bearer bk_live_AbCdEfGhIj_<48 characters>
```

Keys look like `bk_live_<prefix>_<secret>`. The 10 character prefix is public:
the dashboard shows it so you can tell keys apart and it is stored on messages
you send. The secret is shown **once**, when the key is created, and Bookly
stores only a hash of it. If you lose a key, revoke it and create another.

- A key belongs to one organisation; every request acts as that organisation and
  can only see its data.
- Revoking a key takes effect immediately.
- A bad, unknown, revoked or malformed key always gets the same `401`, whatever
  the reason, so keys cannot be probed.
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
| 401 | `unauthorized` | Missing, malformed, unknown or revoked key. |
| 402 | `quota_exceeded` | The organisation's monthly message quota is used up. |
| 403 | `forbidden` | The key lacks the required scope (the message names it). |
| 404 | `not_found` | No such record **in your organisation**. Other organisations' ids look identical. |
| 409 | `conflict` | For example a customer with that phone already exists. |
| 422 | `window_closed` | A free-form message was refused because the 24-hour window is closed. |
| 422 | `channel_not_connected` | The organisation has no connected channel for that conversation. |
| 422 | `payments_not_configured` | The organisation has not connected its own Paystack account. |
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
| `GET /developer/api-keys` | List keys: `id`, `name`, `prefix`, `scopes`, `lastUsedAt`, `revokedAt`, `createdAt`. Never the key. |
| `POST /developer/api-keys` | Body `{ "name", "scopes": [...] }`. Returns `{ "data": { "key": "bk_live_...", "apiKey": {...} } }`. **The full key appears only here.** At most 20 active keys per organisation (`409` beyond). |
| `DELETE /developer/api-keys/:id` | Revoke. Immediate and idempotent. |
| `GET /developer/external-app` | `{ name, url, isActive, createdAt, updatedAt }` or `null`. Never the secret. |
| `PUT /developer/external-app` | Body `{ "name", "url", "isActive"? }`. Creates or updates. On creation the response includes `signingSecret` (shown once). |
| `POST /developer/external-app/rotate-secret` | New `signingSecret`, returned once. The old one stops working at once; update your app first or accept a gap. |
| `DELETE /developer/external-app` | Remove the app and stop delivery. |

`lastUsedAt` is approximate: it is updated at most every 5 minutes per key.

Saving the external app maintains one managed webhook subscription (description
`external-app`) with the same URL and secret, carrying the events listed above.
Setting `isActive: false` or deleting the app switches delivery off; the
subscription row and its delivery history are kept. It counts toward the
organisation's webhook limit.
