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

- [ ] **D1. Workflow engine.** Flow definitions (data), a step catalogue,
      per-conversation state, idempotent per inbound message, human handoff.
      New handler kind at the conversation seam.
- [ ] **D2. External app handler + public API v1.** A tenant's conversations
      can be handed to an app hosted anywhere: inbound messages delivered by
      signed webhook, replies and actions through the API with a scoped key.
- [ ] **D3. Events and outgoing webhooks.** Domain events (message.received,
      payment.succeeded, conversation.handoff, ...) with signed, retried
      delivery to subscribed URLs.
- [ ] **D4. Notifications beyond bookings and orders.** Generic reminders and
      email fallback through Customer records.
- [ ] **D5. Link customer records** to conversations, bookings and orders.
- [ ] **D6. Shared app kit.** packages/ui, packages/api-client,
      packages/auth-client; web app uses them.
- [ ] **D7. Login across domains** for allowed origins, with CSRF protection.

## After TURBO — before salon payments go live

- [ ] **A1. Currency checks** end to end; balances never mix currencies.
- [ ] **A2. Open money findings** from the money security review.
- [ ] **A3. Admin control room v1.** Needs-attention home, organisation
      detail with setup checklist and health, money oversight, audit log,
      messaging health.
- [ ] **A4. Admin roles and two-factor login.**
- [ ] **A5. Support access and emergency switches.**
- [ ] **A6. Workflow editor in the admin** (wording, options, prices;
      publish and roll back).
- [ ] **A7. Plans per vertical and usage-based billing.**
- [ ] **A8. Background jobs in their own process.**
- [ ] **A9. Shop vertical** — product and order tools for the assistant.
- [ ] **A10. Real-database test harness** for money concurrency and
      key routes.

## Log

| Date | Item | Commit | Notes |
|---|---|---|---|
| 2026-10-06 | B3, B4 + withdraw fixes | 468b77e | Alerts, one usage cycle; rejected-transfer reversal was blocked by the guard and falsely reported "money back" — fixed |
| 2026-10-06 | B2 | 779e57a | Guard had NEVER run in prod (context lost after await). Now blocks; proven on real Postgres, 0 false blocks / 0 leaks. Rollback: TENANT_GUARD_MODE=warn |
| 2026-10-06 | B1 | e15c149 | Durable inbox + per-conversation lock + reply outbox; three review rounds closed lost-reply and double-send paths |
| 2026-10-06 | B5 | b206527 | Admin creates organisations with emailed invite; alerts page |
