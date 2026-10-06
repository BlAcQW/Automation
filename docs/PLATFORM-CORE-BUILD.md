# Bookly as the core — build tracker

Goal: Bookly becomes the base every organisation runs on. Each organisation
gets its own workflow (a pack), and apps hosted anywhere — like TURBO — can
plug in over a public API.

Rules this work is held to: tests first, tenant isolation on every new table,
append-only money and balances, idempotent on every external event, fail
safe and loudly, code + security review before each commit, one commit per
item. See [architecture brainstorm](https://claude.ai/code/artifact/81043827-5799-4f38-be9a-c539075e29b6).

## Scope and assumptions

- This is the platform work. The TURBO product itself (rides, passes,
  dispatch, console) is a separate build afterwards; the workflow engine is
  proven against a TURBO-shaped sample flow.
- Defaults used for open questions: destinations from a numbered list;
  pass expiry configurable (default: hard expiry, reminder at day 50); login
  works whether TURBO's console is on a Bookly subdomain or its own domain.
- Nothing is deployed: pushing is blocked by the git hook, and migrations are
  verified on a throwaway database only.

---

## Before TURBO — trust

- [x] **B1. Queue incoming messages.** Webhook stores and enqueues, then
      returns; a worker processes one message at a time per conversation.
      Fixes lost messages on crash/deploy and double replies on the AI path.
- [x] **B2. Tenant guard blocks.** Fix the ~15 "verify then mutate by id"
      call sites, then make the guard throw instead of warn.
- [x] **B3. Alerts reach a person.** Loud failures (unattributed payments,
      wallet currency mismatch, unknown notification purposes, failed
      payouts/refunds) become platform alerts and Sentry issues.
- [x] **B4. Usage-count bug.** One key format in TenantUsage.
- [x] **B5. Create an organisation from the admin**, with vertical, plan,
      quota and an owner invite.

## During TURBO — multiple workflows

- [x] **D1. Workflow engine.** Flow definitions (data), a step catalogue,
      per-conversation state, idempotent per inbound message, human handoff.
      New handler kind at the conversation seam.
- [x] **D2. External app handler + public API v1.** A tenant's conversations
      can be handed to an app hosted anywhere: inbound messages delivered by
      signed webhook, replies and actions through the API with a scoped key.
- [x] **D3. Events and outgoing webhooks.** Domain events (message.received,
      payment.succeeded, conversation.handoff, ...) with signed, retried
      delivery to subscribed URLs.
- [x] **D4. Notifications beyond bookings and orders.** Generic reminders and
      email fallback through Customer records.
- [x] **D5. Link customer records** to conversations, bookings and orders.
- [x] **D6. Shared app kit.** packages/ui, packages/api-client,
      packages/auth-client; web app uses them.
- [x] **D7. Login across domains** for allowed origins, with CSRF protection.

## After TURBO — before salon payments go live

- [x] **A1. Currency checks** end to end; balances never mix currencies.
- [x] **A2. Open money findings** from the money security review.
- [x] **A3. Admin control room v1.** Needs-attention home, organisation
      detail with setup checklist and health, money oversight, audit log,
      messaging health.
- [x] **A4. Admin roles and two-factor login.**
- [x] **A5. Support access and emergency switches.**
- [x] **A6. Workflow editor in the admin** (wording, options, prices;
      publish and roll back).
- [x] **A7. Plans per vertical and usage-based billing.**
- [x] **A8. Background jobs in their own process.**
- [x] **A9. Shop vertical** — product and order tools for the assistant.
- [x] **A10. Real-database test harness** for money concurrency and
      key routes.

## Log

| Date | Item | Commit | Notes |
|---|---|---|---|
| 2026-10-06 | B3, B4 + withdraw fixes | 468b77e | Alerts, one usage cycle; rejected-transfer reversal was blocked by the guard and falsely reported "money back" — fixed |
| 2026-10-06 | B2 | 779e57a | Guard had NEVER run in prod (context lost after await). Now blocks; proven on real Postgres, 0 false blocks / 0 leaks. Rollback: TENANT_GUARD_MODE=warn |
| 2026-10-06 | B1 | e15c149 | Durable inbox + per-conversation lock + reply outbox; three review rounds closed lost-reply and double-send paths |
| 2026-10-06 | B5 | b206527 | Admin creates organisations with emailed invite; alerts page |
| 2026-10-07 | wave 2 schema | 46516bb | Flows, external apps, API keys, events, webhooks, customer links |
| 2026-10-07 | takeover fix | 7d75d8c | Handoff to a human had NEVER worked (takeoverAt column never existed) — fixed + schema-conformance test |
| 2026-10-07 | D1 | 4e3627f | Workflow engine; stale-link underpay closed after security review |
| 2026-10-07 | D3 | 3e68d19 | Events + signed webhooks, SSRF-checked at delivery, per-tenant fairness |
| 2026-10-07 | D2 | 180e5ac | Public API v1 + developer settings; TRUST_PROXY fixes a platform-wide lockout |
| 2026-10-07 | D4, D5 | 759b81e | Customers linked, generic reminders, double-refund race closed |
| 2026-10-07 | D6, D7 | f637a1a | Shared UI/API/auth packages; cross-site login with CSRF |
| 2026-10-07 | wiring | bd0793b | Per-tenant engine on all channels; payment events can't be lost; late payment no longer resurrects expired holds |
| 2026-10-08 | wave 3 schema | 9e28f7d | Admin roles/2FA, switches, support sessions, billing terms, refund retry columns |
| 2026-10-08 | A1, A2 | 2565b7a | Currency enforced in the wallet lock; order refunds; refund retry; payout reaper; withdrawal step-up |
| 2026-10-08 | A3-A6 | 4af3b49 | Control room, roles + 2FA, refresh families, support sessions (deny-by-default, always masked), flows editor |
| 2026-10-08 | A7 | da5ddab | Plans per vertical, usage billing from the audit trail |
| 2026-10-08 | A5, A8 | d592870 | Worker process role, emergency pause enforced before counters, 423 outbound_paused |
| 2026-10-08 | A9 | e8f6228 | Shop vertical; typed phones on IG/Messenger prove nothing; masking gaps from the security re-review closed |
| 2026-10-08 | A10 | 988e4e5 | Real-DB harness found 5 races (wallet, deadlock, usage, resolver, duplicate owner email), all fixed |
