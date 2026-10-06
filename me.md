# Things only you can do

Everything on this list is outside the code. Nothing here can be finished by
writing software — it needs an account, an approval, a decision, or your card.

Several finished features are sitting inert waiting on items in here.

Last updated: 30 September 2026.

---

## The short version

| # | Thing | Unblocks | Effort |
|---|---|---|---|
| 1 | Add a card to your WhatsApp number in Meta | Your bot still replying after 1 Oct | 10 min |
| 2 | Paystack: aggregator approval + Registered business | All payments and payouts | Weeks — start now |
| 3 | **WhatsApp: register 5 message templates** | Reminders, confirmations — none can send today | Half a day + approval |
| 3b | Meta App Review: Instagram + Messenger | Two finished channels | 1 day + Meta's queue |
| 4 | Arkesel account for Bookly | Reminders without tenants configuring SMS | 1 hour |
| 5 | Decide the fee % and the new-tenant hold | Pricing, fraud exposure | A decision |
| 6 | Rotate two secrets | Security hygiene | 20 min |
| 7 | `git push origin Dev` | Everything built this session is local only | 1 min |

---

## 1. WhatsApp — add a card before 1 October

**Why:** from 1 October Meta charges for service messages — the ordinary
replies your bot sends inside the 24-hour window. Reporting from several
providers says a WhatsApp Business Account with **no payment method on file by
30 September stops delivering them**. I could not confirm that date on Meta's
own documentation, so treat it as likely rather than certain — but the fix is
ten minutes and the downside is your bot going silent.

- [ ] Meta Business Suite → Billing & Payments → select the WABA → add a card
- [ ] Do this for your own test number at minimum

**Note:** Meta takes Visa/Mastercard/Amex, PayPal, or direct debit. It does
**not** take Mobile Money. This is the single reason most Ghanaian salons
cannot complete WhatsApp setup themselves.

---

## 2. Paystack — the big one, start it first

Everything about money is built and **cannot be switched on** without these.
Both are slow, so they should be in motion while other work continues.

- [ ] **Get written aggregator / marketplace approval.** You will be collecting
      payments on behalf of other businesses into your own Paystack account.
      Doing that without explicit sign-off risks the account being frozen —
      with your tenants' money inside it. Ask in writing and keep the reply.
- [ ] **Get Registered business status.** Paystack Transfers are gated on it,
      and every payout depends on Transfers. Without it nobody can withdraw.
- [ ] Confirm your Paystack account is **GHS-only**, or tell me, because the
      code does not yet validate currency and a second enabled currency would
      credit wrongly.
- [ ] Confirm the Paystack webhook URL points at
      `https://bookly.ikieguy.online/api/payments/webhook` and that **transfer
      events** are enabled, not just charges. If transfers go elsewhere,
      payouts will never be marked paid.

> Separately worth asking them: you are holding funds for third parties, which
> is regulated in Ghana under the Payment Systems and Services Act 2019. Ask
> Paystack what they require of you, and consider a lawyer's view. This is not
> legal advice.

---

## 3. WhatsApp — the part still outstanding as a Tech Provider

Your Tech Provider verification is **done**, and you have Advanced access to
`whatsapp_business_messaging` and `whatsapp_business_management`. Nothing more
is needed on that. But four things sit outside the codebase and one of them is
currently breaking a core feature.

### 3.1 Register your message templates — nothing works out-of-window without them

**You have zero templates registered.** I checked: the database has none, and
none are approved.

This matters more than it sounds. WhatsApp only allows free-typed messages
within 24 hours of the customer's last message. Outside that window you may
send **only approved templates** — so with none registered, every one of these
silently fails to send:

| Purpose | When it fires | What breaks without it |
|---|---|---|
| `BOOKING_CONFIRMATION` | After a deposit is paid | Customer never gets confirmation |
| `BOOKING_REMINDER` | Before the appointment | **No reminders — half the no-show story** |
| `BOOKING_RESCHEDULED` | After a time change | Customer not told the new time |
| `BOOKING_CANCELLED` | On cancellation | Customer not told |
| `ORDER_CONFIRMATION` | After an order is paid | Buyer never gets confirmation |

- [ ] Go to **WhatsApp Manager → Account tools → Message templates**
- [ ] Create and submit all five. Category **Utility**, not Marketing —
      utility is cheaper and approves more easily for transactional messages
- [ ] Match the variable order the code sends. For the reminder that is:
      customer name, service, date, time, booking reference
- [ ] Wait for approval, then check they appear on the Templates page in Bookly

> Reminders are the single biggest reason a deposit reduces no-shows. Until
> these exist, that half of the product is not running.

### 3.2 Flip the app to Live mode

- [ ] Meta app dashboard → toggle from **Development** to **Live**

In Development mode only people with a role on the app can be messaged. Real
salon customers cannot be reached at all, so no tenant can genuinely onboard.

### 3.3 Confirm the webhook is subscribed

- [ ] App dashboard → WhatsApp → Configuration → confirm the callback URL is
      `https://bookly.ikieguy.online/api/whatsapp/webhook` and that the
      **`messages`** field is subscribed

A verified URL with no field subscription looks healthy and delivers nothing.

### 3.4 Display name approval

Each number's display name is reviewed by Meta when a tenant connects. It is
what customers see as the sender, so if a tenant's business name is rejected
they need to pick another. Nothing to do now — just know it is a step that can
fail during onboarding rather than a setting you control.

---

## 3b. Meta App Review — Instagram and Messenger

Both channels are **built, tested and merged**. They cannot serve a single
customer until Meta grants Advanced Access. Business Verification is already
done from the WhatsApp round, which is normally the slowest part.

Full runbook with the screencast rules and the use-case text is in
[futurefeature.md](futurefeature.md) section 0. The prerequisites that fail
**silently** if missed:

- [ ] **Make one real API call with each permission first** — required within
      30 days before submitting, and it takes up to 2 days to register.
      Connect your own Page and Instagram in dev mode and put a real DM
      through.
- [ ] **Turn on message access on the Instagram account.** Instagram app →
      Settings → Messages and story replies → Message controls → Connected
      tools → Allow access to messages. **If this is off, webhooks never
      arrive and there is no error anywhere** — not in our logs, not Meta's.
- [ ] **Give your test Facebook account a role on the app.** In dev mode only
      app-role users can message the IG account, so without it you cannot even
      record the demo.
- [ ] **Update the privacy policy.** It currently says "Meta" but never names
      Instagram, Facebook or Messenger, or what data we receive. That is a
      documented rejection cause.
- [ ] **Create a test Bookly account for the reviewer** with nothing connected.
      They test with their own accounts and will not use your credentials.
- [ ] Record **one screencast per permission**, each showing the Facebook
      consent screen with the scopes visible. A general product tour that never
      isolates the permission is the most common way these fail.

Permissions to request, all in one submission:
`pages_messaging`, `instagram_manage_messages`, `instagram_basic`,
`pages_show_list`, `pages_manage_metadata`. Nothing else — asking for more
than the use case justifies is itself grounds for rejection.

---

## 4. Accounts to create, and what to put in `.env`

Everything below is missing today, and each absent value simply disables its
feature rather than breaking anything.

### Bookly's own WhatsApp number service *(optional — see note)*

- [ ] Create a WABA under **your** Meta Business Manager
- [ ] Attach your card to it
- [ ] Create a System User with `whatsapp_business_management` +
      `whatsapp_business_messaging` on that WABA, and generate a token

```
PLATFORM_WABA_ID=...
PLATFORM_WHATSAPP_TOKEN=...
```

> **Note:** this hosts tenant numbers on your WABA so you pay Meta instead of
> them. It caps at **20 numbers per business portfolio** (Meta's limit), and
> tenants can never migrate their number away. Worth doing only if you decide
> to serve MoMo-only salons on WhatsApp rather than pushing them to Instagram.

### Text messages on your account

- [ ] Open an Arkesel account for Bookly and register a sender ID

```
PLATFORM_ARKESEL_API_KEY=...
PLATFORM_ARKESEL_SENDER_ID=Bookly        # what customers see as the sender
PLATFORM_SMS_BUDGET=200                  # per tenant per month; optional
```

### Your fee

```
PLATFORM_FEE_BPS=0        # basis points. 250 = 2.5%. 0 = no fee.
```

Already set and needing nothing: `BOOKINGFLOW_PAYSTACK_SECRET_KEY`,
`NEXT_PUBLIC_WHATSAPP_APP_ID`.

---

## 5. Decisions nobody can make for you

- [ ] **What percentage do you take?** The mechanism is built and set to zero.
      Price it against what a salon recovers in no-shows, not against other
      software.
- [ ] **Hold money from new tenants before their first payout?** Today funds
      clear the moment a job is marked done, as you asked. The state machine
      stops instant fraud, but not the patient version: register, take a
      deposit on a stolen card, wait for the appointment time, mark it done,
      withdraw — and you eat the chargeback. A hold on **new tenants only**
      would close it without making established salons wait. Say the word and
      I will build it.
- [ ] **Rebuild the plan cards.** They still advertise message counts you no
      longer supply. See [what-bookly-sells.pdf](docs/strategy/what-bookly-sells.pdf).
- [ ] **Solution Partner, eventually?** It would let you bill tenants for
      WhatsApp messages instead of them paying Meta. Long process; revisit
      when you have volume to show.

---

## 6. Security hygiene

- [ ] **Rotate the Supabase database password.** Its prefix was printed to a
      terminal during a migration earlier in this project.
- [ ] **Rotate the WhatsApp access token** that appeared in a screenshot.
- [x] ~~Decide whether `/payments/connect` should reject `sk_test_` keys.~~
      Done (4 Oct): in production it now only accepts `sk_live_` / `pk_live_`.
      **If your own tenant is connected with a test key, reconnect with live
      keys** or that tenant cannot save its settings again.

---

## 7. Deploy and operations

- [ ] **`git push origin Dev`** — your git hook blocks me from pushing, so
      everything built in this session exists only on this server.
- [ ] After pulling: `npm install --legacy-peer-deps`, then rebuild both apps.
- [ ] **Before deploying the 4 Oct changes**, check for duplicate outbound
      message ids — the new unique index refuses to build on them, and a failed
      migration stops the API starting:
      ```sql
      SELECT "conversationId","whatsappMsgId",count(*) FROM "Message"
      WHERE "whatsappMsgId" IS NOT NULL AND "direction"='OUTBOUND'
      GROUP BY 1,2 HAVING count(*)>1;
      ```
      Zero rows = safe. Duplicate *inbound* rows are cleaned up by the
      migration itself. Back up the database first either way.
- [ ] **Set `REDIS_URL` in production.** Incoming messages are now queued.
      Without Redis they still work, but processed inside the API, and
      message ordering per conversation only holds within one process.
- [ ] **Know the tenant-guard switch.** The guard that keeps one business
      from touching another's data now *blocks* instead of only warning.
      It was proven against a real database with the real app, but if
      anything legitimate is ever blocked after a deploy (users see a
      generic "something went wrong"), set `TENANT_GUARD_MODE=warn` and
      restart — no code change needed — then tell me which screen failed.
- [ ] **Run the customer backfill once after deploying** (links past
      bookings, orders and chats to customer records). Dry run first:
      `cd apps/api && npx tsx scripts/backfill-customers.ts --dry-run`,
      then without `--dry-run`.
- [ ] **Optional settings (all off/safe by default):** `TRUST_PROXY`
      (default trusts the local nginx — leave it); `CROSS_SITE_AUTH=true`
      only if a console like TURBO's runs on its own domain (requires
      HTTPS everywhere — the API refuses to start otherwise); list that
      console's address in `CORS_ORIGINS`.
- [ ] **Public API docs for client developers:** `docs/API.md`. Keys and
      the external-app address are set by the organisation owner under
      Developer settings.
- [ ] **Fix organisations still on the old NGN currency default.** New
      organisations now get GHS, but older ones may still say NGN, and the
      money ledger refuses to mix currencies. Review first:
      ```sql
      SELECT t.id, t.name, t."paymentCurrency", w.currency AS wallet,
             (t."paystackSecretKey" IS NOT NULL) AS own_paystack
      FROM "Tenant" t LEFT JOIN "Wallet" w ON w."tenantId" = t.id
      WHERE t."paymentCurrency" = 'NGN';
      ```
      For Ghanaian businesses without their own Paystack, set GHS:
      `UPDATE "Tenant" SET "paymentCurrency"='GHS' WHERE id IN (...);`
      Leave any that genuinely use their own NGN Paystack account.
- [ ] **Withdrawals now ask for the owner's password** (both web and
      mobile). Tell owners before deploying so it isn't a surprise.
- [ ] **Check the new Alerts page in the admin** after deploying. Payments
      nobody can match, failed payouts and refunds, and messages that could
      not be processed all land there.
- [ ] **nginx config is not in git.** `/etc/nginx/sites-available/bookly.ikieguy.online`
      must be re-applied by hand if the server is ever rebuilt. It carries the
      WebSocket upgrade and forwarded-host headers that two separate bugs
      traced back to.
- [ ] **Supabase free tier auto-pauses after about a week idle.** When it does,
      the API crash-loops on P1001. Fix: resume the project, then
      `pm2 restart bookly-api`.
- [ ] Flip the Meta app to **Live** mode when you are ready for real tenants.
- [ ] **Admin accounts after the wave 3 deploy (8 Oct changes):**
      - Every admin is signed out once and must log in again (sign-in
        sessions are now tracked as families that can be revoked).
      - `REDIS_URL` is now **required** for admin sign-in to stay logged in
        in production. Without it admins are bounced to the login page every
        15 minutes (see `ADMIN_REFRESH_ALLOW_NO_REDIS` in `.env.example`).
      - Admins have roles now: OWNER, SUPPORT, FINANCE, READONLY. Existing
        super-admins become OWNER, other existing admins SUPPORT. New admins
        made with the script are SUPPORT unless you pass a role:
        `npm run admin:create -w apps/api -- --email you@example.com --name "Your Name" --role OWNER`.
      - Turn on two-factor sign-in for every OWNER admin (admin → Account).
- [ ] **Behaviour changes owners will notice:**
      - Only the owner can cancel a **paid** order or booking, because it
        refunds the customer. Staff get a clear message asking the owner.
      - "Send test message" is now owner-only and counts towards the plan.
      - Unpaid orders with a payment link expire (default 60 minutes,
        `ORDER_EXPIRY_MINUTES`) and their stock goes back on the shelf.
      - On Instagram and Messenger the assistant only discusses orders and
        bookings made in that same chat. A typed phone number is not proof
        of who someone is.
      - Adding a team member with an email that already has a Bookly login
        (in any business) is refused: one email, one account.
- [ ] **Never run `npm run db:seed` against production.** It now refuses to
      unless the database is local; the demo admin it creates gets a random
      password printed once.

---

## What is finished and waiting on this list

| Built | Waiting on |
|---|---|
| Instagram + Messenger channels | App Review (item 3) |
| Payment collection, wallet, payouts | Paystack approval (item 2) |
| SMS on Bookly's account | Arkesel account (item 4) |
| Bookly-hosted WhatsApp numbers | Platform WABA (item 4) |
| Everything from this session | `git push` (item 7) |
