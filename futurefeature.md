# Future features

Work that is understood but not built. Each entry says what it is, what it's
blocked on, and what it's worth — so the next person picking it up doesn't have
to rediscover the research.

Last updated: 13 September 2026.

---

## Priority order

| # | Feature | Effort | Value | Blocked on |
|---|---------|--------|-------|-----------|
| 1 | Verify WhatsApp Flows still work | ~1 hour | **Very high** | Nothing |
| 2 | Billing from captured categories | ~2 days | **Very high** | Nothing |
| 3 | Address request | ~1 day | High (PRODUCT tenants) | Nothing |
| 4 | Abandoned-booking sweep | ~1 day | High | Nothing |
| 5 | Send location | ~half day | Medium | `expo-location` on mobile |
| 6 | Download inbound media | ~1 day | Medium | Nothing |
| 7 | Send contact card | ~2 hours | Low | Nothing |
| 8 | Voice & video calling | ~1 week+ | Medium | Custom dev build |
| 9 | Groups | ~3 days | **Low** | Meta OBA, per tenant |

---

## 1. Verify WhatsApp Flows

**What it is.** Flows are WhatsApp's in-chat mini-apps. Instead of the bot asking
twenty questions one at a time, the customer taps a button and fills in a proper
form — service, date, time — on one screen without leaving WhatsApp.

**Why it's the top item.** This is the single biggest lever on unit economics we
found. A Flow turns a ~10-message booking into ~4:

| Flow design | Messages/booking | Bookings per 1,000 messages |
|---|---|---|
| Free-text Q&A (today) | 10 | 90 |
| Buttons for service + time | 6 | 142 |
| List picker + Flow form | 4 | **200** |

That's **2.2× more bookings from the same message allowance** — it doesn't cut
cost per message, it cuts messages per booking, which is what the customer feels.

**Status.** The codebase references Flows, so someone built toward it. Nobody has
confirmed it still works. It might be complete, half-finished or broken.

**Blocked on.** Nothing. Someone just needs to run a booking through it.

---

## 2. Billing from captured categories

**What it is.** Turning the billing data we now capture into actual charging.

**What already exists.** As of the September 2026 work, every outbound message
records what Meta actually billed it as:

- `Message.billingCategory` — `service` / `utility` / `marketing` / `authentication`
- `Message.billable` — false inside free allowances and free entry-point windows
- `Message.status` — `SENT` / `DELIVERED` / `READ` / `FAILED`

All three come from Meta's own status webhook, so they account for free
allowances, free entry-point windows and template re-categorisation — none of
which can be inferred at send time.

**What's missing.** The wallet, the deduction, and the statement. Agreed model:

- One balance in **cedis**, not "credits" — credits hide the price
- Deduct on **delivery**, not on send; Meta only charges for delivered messages
- **Conversations never block** at zero balance; a stranded customer mid-chat
  breaks the product and the message costs ~6 pesewas
- **Campaigns hard-block** before sending, never halfway through a list
- Campaigns must reserve a **reply budget** (~GHS 0.18/recipient) so a blast
  can't spend the balance needed to answer the demand it creates

**Agreed rates** (see the rate sheet artifact for the full model):

| | Your cost | Sell |
|---|---|---|
| Conversation reply | GHS 0.058 | **GHS 0.15** |
| Campaign recipient | GHS 0.326 | **GHS 0.50** |
| Inbound | GHS 0 | free |

**Deadline.** Service messages became billable on **1 October 2026**. Before that
date, bot and operator replies inside the 24-hour window were free.

**Two constraints.** GHS 0.50 works for **Ghana only** — Nigeria's marketing rate
is GHS 0.748, so every Nigerian recipient loses GHS 0.248. Enforce destination at
send time. And blast margin erodes with FX: 35% at GHS 14.5/USD, 19% at 18,
break-even at 22.2. Conversations break even at GHS 38/USD — no real risk.

**Verify first.** The Free plan assumes Meta's **first 1,000 service messages per
month are free per phone number**. If that allowance turns out to be per platform
rather than per tenant, 500 free tenants costs GHS 29,000/month instead of zero.

---

## 3. Address request

**What it is.** A WhatsApp message that opens a form inside the customer's
WhatsApp asking for a delivery address — street, city, phone — returned as
structured fields.

**Why it matters.** PRODUCT tenants take orders today with addresses as free
text: "the blue gate near the junction". The bot can't parse that. This fixes it
at the source.

**Blocked on.** Nothing. Needs an interactive message of type `address_message`
and a handler for the structured reply.

---

## 4. Abandoned-booking sweep

**What it is.** Noticing when someone starts a booking and goes quiet.

**The failure mode.** The 24-hour window is a rolling timer reset by each
*customer* message — your own messages don't extend it. So:

```
14:00  customer: "I want to book"
14:02  customer: "haircut"
14:03  bot: "what day?"
       …customer gets distracted, never replies
14:03 (+24h)  window closes
```

You now hold a half-finished booking and no free way to reach them. Nothing in
the code notices.

**Two halves, in order:**

1. **Nudge before expiry** — sweep for incomplete flows at ~23 hours and send one
   in-window message. One service message; trivially cheaper than a lost booking.
2. **Re-engage after expiry** — an approved **utility** template. Paid, but
   utility is the cheap category and it recovers revenue.

Also worth handling: stale `botContext`. Someone returning after a week shouldn't
be asked "what day?" about a conversation they've forgotten. `contextVersion`
exists on the model already.

**Blocked on.** Nothing. Fits the notification worker that already runs.

---

## 5. Send location

**What it is.** A button for the operator to send "here's where we are".

**Status.** Receiving works on both platforms — a customer's location renders as
a card that opens Maps. Sending is scaffolded but off.

**Blocked on.**

- **Web** — nothing. `navigator.geolocation` is built into browsers; the handler
  is written and works. One flag flip.
- **Mobile** — `npx expo install expo-location` plus the iOS permission string
  (`NSLocationWhenInUseUsageDescription`) in `app.json`.

API is done: `POST /conversations/:id/rich` with `{ type: 'location' }`.

---

## 6. Download inbound media

**What it is.** When a customer sends a photo, Meta gives us a media ID, not the
file. We store the ID and never fetch the bytes, so the dashboard shows
"image from customer — not downloaded".

**Why it matters.** Customers send photos of what they want — a haircut
reference, a damaged part, a product. Right now the operator can't see any of it.

**Blocked on.** Nothing. Needs a worker that exchanges the media ID for a
download URL using the tenant's token and stores the file the same way outbound
media is stored. Note Meta's media IDs **expire after ~30 days**, so this has to
run promptly, not lazily on first view.

---

## 7. Send contact card

**What it is.** Sending a vCard — referring a customer to another business, or
sharing a staff member's number.

**Blocked on.** Nothing technical; the API accepts it today. It needs a small
name/phone form, and it's the least-used rich type, so it hasn't earned space in
the composer yet.

---

## 8. Voice & video calling

**What it is.** Real voice and video calls over WhatsApp, via Meta's Calling API.

**The blocker is your development workflow, not WhatsApp.** Calling needs
**WebRTC**, the technology that carries live audio between devices. **Expo Go —
the app you scan the QR code into — does not contain WebRTC**, and no amount of
JavaScript adds it. Expo Go is a pre-built app with a fixed set of native
features.

Getting calling means moving to a **custom dev build**: your own compiled app,
installed on the device.

What changes:

- No more QR scanning — you install a build
- Each new native package needs a fresh build (~15–20 min via EAS, or Xcode)
- JavaScript changes still hot-reload exactly as now

**Pricing note.** Calling has its **own rate card**, priced per call duration in
six-second pulses — it does not fit the per-message wallet. But
**customer-initiated calls are free**; only business-initiated calls are billed.
Inbound-only calling therefore costs nothing, which makes "call your barber"
a free feature if outbound is left off.

---

## 9. Groups

**What it is.** Group conversations with up to 8 participants.

**Blocked on Meta, not code.** Every tenant needs **Official Business Account**
status individually:

- 30+ days on the WhatsApp Business Platform
- Business portfolio verified by Meta
- Two-step verification enabled
- Approved display name

That's weeks of paperwork **per tenant**, and a barbershop or home salon will
never bother.

**The payoff is small.** Maximum 8 participants, calling doesn't work in groups,
and messages are charged **per participant delivered** at normal rates — an
8-person group costs 8 charges. It's for a family booking a spa day, not for
reaching customers; that's campaigns, which already exist.

**Recommendation: don't build this.** It's the weakest item here and the only one
gated on other people's admin.

---

## Smaller UX items

From the WhatsApp comparison, none started:

- **Swipe actions** on chat rows (archive, mark read, pin)
- **Haptics** — a large part of why WhatsApp feels physical
- **System font** — the app uses Plus Jakarta Sans + Inter; WhatsApp uses SF Pro.
  Switching would read as more native, but it changes every screen, so it needs a
  deliberate decision
- **Collapse-on-scroll large titles** — currently static; WhatsApp's shrink as
  you scroll. Needs per-screen scroll handlers and buys little at this size
- **Chat wallpaper** is a flat colour, not WhatsApp's doodle texture. Needs an
  actual asset

---

## Known pre-existing issues

Not features, but worth recording:

- **7 TypeScript errors** in `apps/api/src/routes/calendar/index.ts` and
  `services/calendar.ts` — a duplicate `google-auth-library` in the dependency
  tree (`googleapis-common/node_modules/google-auth-library@10.5.0` alongside
  root `10.9.1`). Verified pre-existing, present before any of the September
  2026 work.
- **Validation errors return HTTP 500**, not 400. Posting an invalid email to
  `/auth/login` returns `500` with the raw Zod JSON in the message — exposing the
  internal validation shape publicly.
- **`apps/api` has no ESLint config**, so `npm run lint -w apps/api` fails.
- **Historical messages can't be backfilled.** The 254 messages that existed
  before September 2026 have no Meta message ID, so they'll stay `status: null`
  forever. Delivery and billing data accumulates from new sends only.
