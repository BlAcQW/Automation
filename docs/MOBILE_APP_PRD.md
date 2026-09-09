# Bookly Mobile App — Product Requirements Document (PRD)

**Status:** Draft v1 · **Date:** 2026-09-07 · **Owner:** Bookly team
**Platform:** iOS + Android (cross-platform) · **Framework:** React Native (Expo)
**Audience of app:** Business owners & staff (tenant-facing)
**MVP scope:** Full parity with the tenant-facing web dashboard (SERVICE-mode first)

---

## 1. Context & Why

Bookly is a multi-tenant, WhatsApp-first booking & commerce SaaS. Businesses ("tenants") connect
their own WhatsApp Business number; their customers book, reschedule, cancel, and pay over a
WhatsApp bot, with human takeover. Owners/staff manage everything from a web dashboard
([apps/web](../apps/web)) backed by a Fastify + Prisma API ([apps/api](../apps/api)).

The web app is already a mobile-responsive PWA, but a business owner's core job — **reply to a
customer and manage the day's bookings** — is inherently on-the-phone work. A native app unlocks the
one thing the PWA cannot do well: **real-time push notifications** for new bookings and new WhatsApp
messages. That, plus a fast native chat inbox, is the reason to build this.

Now that Bookly is a **verified Meta Tech Provider**, real tenants can onboard their own numbers, so
owner activity (and the need to respond quickly on mobile) will grow.

### Goals
- Give owners/staff a fast, native app to run their business from their phone.
- Deliver **push notifications** for new bookings, cancellations, and inbound WhatsApp messages.
- Reach **feature parity** with the tenant-facing web dashboard (SERVICE mode first; PRODUCT mode gated behind the same flag the web uses).
- Reuse the existing REST API and TypeScript domain knowledge; no backend rewrite.

### Non-Goals (v1)
- The **platform-admin** console (`/admin/*`) — separate audience, separate auth. Out of scope.
- **Customer-facing** flows (booking pages, order tracking, payment result pages) — those are the tenant's *customers'* surfaces, delivered via WhatsApp links, not this app.
- Marketing site, legal pages.
- A separate end-customer booking app (possible future phase).

---

## 2. Users & Personas
- **Owner (primary).** Registered as `OWNER` at signup. Full access: bookings, chats, services, availability, settings, billing, WhatsApp connection.
- **Staff (secondary).** `STAFF` role exists in the token model but there is **no endpoint to provision staff today** (see Backend Gap G5). Design the UI for staff (assignment, limited settings) but treat multi-user as a fast-follow once the backend supports it.

---

## 3. Current System — What the App Builds On

Grounded in the codebase (see Appendix A for the full endpoint map).

- **Backend:** Fastify + TypeScript, Prisma/PostgreSQL, Redis + BullMQ workers. Base URL today: `https://bookly.ikieguy.online/api` (nginx → API on :3001). Routes are clean REST, one prefix per resource.
- **Auth:** email/password → JWT. **Access token (15 min)** returned in the response body; **refresh token (7 days)** set as an **HTTP-only cookie**. Roles `OWNER`/`STAFF`. Separate admin JWT namespace (irrelevant to this app).
- **Domain:** `Tenant` is the account; `businessType` (SERVICE|PRODUCT) drives the whole app. Core entities: `Booking`, `Service`, `WorkingHours`/`BlackoutDate`, `Conversation`/`Message`, `Notification`, `MessageTemplate`, `Product`/`Order` (PRODUCT mode), `TenantUsage` (quota).
- **Real-time:** **none.** No WebSocket/SSE. Web uses polling (conversations 5–10s, notifications 30s). No push infrastructure exists.
- **Hard business rules the UI must honor:**
  - **WhatsApp 24-hour window:** free-form replies are rejected (400) if the customer hasn't messaged in 24h; only approved templates send outside it.
  - **Message quota:** per-tenant 30-day cycle (free 50 / starter 500 / pro 5000). Sending returns **402** when exhausted.
  - **Payments are async/webhook-driven:** open Paystack hosted page, then **refetch** state.

---

## 4. Backend Changes Required (do these first — some are blockers)

These gaps were found during code review. They are prerequisites for a good mobile app and should be scoped as backend work alongside the app.

| # | Gap | Severity | Required change |
|---|-----|----------|-----------------|
| **G1** | `POST /auth/refresh` reads the refresh token **only from an HTTP-only cookie** ([apps/api/src/routes/auth/index.ts](../apps/api/src/routes/auth/index.ts)). A native app has no cookie jar by default. | **Blocker** | Add a mobile-friendly refresh: accept the refresh token in the request **body or `Authorization` header**, and **return it in the login/register response body** (guarded to mobile clients, e.g. an `X-Client: mobile` header). Keep cookie behavior for web. |
| **G2** | No push infrastructure: no device-token storage, no FCM/APNs, no `Notification`→device fan-out. | **Blocker for the core value prop** | Add a `DeviceToken` model (`userId`, `token`, `platform`, `lastSeenAt`); endpoints `POST /devices/register` / `DELETE /devices/:token`; fan out via **Expo Push** (simplest) or FCM/APNs when a `Notification` row is created and on inbound `Message`. |
| **G3** | No real-time transport; chat/inbox rely on polling. | High | Short term: polling is acceptable (mirror web intervals). Medium term: add WebSocket/SSE for the open chat thread, or rely on push + refetch. PRD assumes **push + smart polling** for v1. |
| **G4** | No booking/conversation "list changed since" cursor for cheap polling. | Medium | Add `updatedSince`/cursor params to `GET /conversations` and `GET /bookings` to make background polling cheap. Optional for v1. |
| **G5** | No endpoint to create `STAFF` users (registration only makes `OWNER`). | Medium | Add tenant user-management endpoints (`POST /users`, list, deactivate) to enable the staff persona. Fast-follow. |
| **G6** | Meta **Embedded Signup** uses the Facebook JS SDK (web-only). | Medium | For mobile, use Facebook Login for iOS/Android with the WhatsApp Embedded Signup `config_id`, **or** open the signup flow in an in-app browser (WebView) and capture the `code`, then POST `/whatsapp/embedded-signup`. Manual-connect fallback (paste credentials) works as-is. |
| **G7** | CORS allow-list has no mobile origin ([apps/api/src/index.ts](../apps/api/src/index.ts)). | Low | Native clients send no Origin, so unaffected. Only relevant if any screen is a WebView calling the API with credentials. |

---

## 5. Tech Stack & Architecture

**Framework:** React Native via **Expo** (managed workflow, EAS Build/Submit).
Rationale: shares TypeScript + React with the existing [apps/web](../apps/web); the team can reuse
domain types, the API client shape, and validation logic. Fastest path to iOS+Android from one
codebase, and Expo gives push notifications, secure storage, and OTA updates out of the box.

**Recommended libraries**
- **Navigation:** Expo Router (file-based) or React Navigation (stack + bottom tabs).
- **Server state:** TanStack Query (mirrors the web app; handles caching, refetch, polling, optimistic updates).
- **HTTP:** Axios or fetch wrapper replicating the web `api.ts` **401 → refresh → retry** interceptor ([apps/web/src/lib/api.ts](../apps/web/src/lib/api.ts)).
- **Secure token storage:** `expo-secure-store` (access + refresh tokens).
- **Push:** `expo-notifications` (Expo Push) → later FCM/APNs directly if needed.
- **Forms/validation:** React Hook Form + Zod (reuse schemas conceptually from the API).
- **UI:** NativeWind (Tailwind for RN) to echo the web design system, or Tamagui; a small shared component kit (Button, Card, Input, Badge, Sheet).

**Suggested repo layout:** add `apps/mobile/` to the existing npm workspaces monorepo so shared
types can live in a `packages/shared` later.

```
apps/mobile/
├── app/                 # Expo Router routes (tabs + stacks)
├── src/
│   ├── api/             # client + endpoint hooks (TanStack Query)
│   ├── auth/            # token store, refresh interceptor, AuthProvider
│   ├── features/        # bookings, conversations, services, availability, settings...
│   ├── components/ui/   # shared primitives
│   ├── lib/             # formatting, currency, dates, businessType gating
│   └── push/            # device token registration + handlers
└── app.config.ts        # EAS, bundle ids, push config
```

**Environment/config:** `API_BASE_URL` (prod `https://bookly.ikieguy.online/api`), Meta
`app_id`/`config_id` for Embedded Signup, Paystack public context (open hosted URL only), Sentry DSN.

---

## 6. Feature Requirements (by module)

Each maps to real endpoints (Appendix A). Screens mirror the web `BottomTabBar` opinion of the top
surfaces: **Overview · Bookings · Chats · Services · Settings** (SERVICE) — with the tab set switching
for PRODUCT tenants exactly as [apps/web/src/components/dashboard/bottom-tab-bar.tsx](../apps/web/src/components/dashboard/bottom-tab-bar.tsx) does.

### 6.1 Auth & Onboarding
- **Login** (`POST /auth/login`), **Register** (`POST /auth/register`, creates OWNER + 14-day Pro trial), **Logout** (`POST /auth/logout`).
- Store access token in `expo-secure-store`; implement refresh (depends on **G1**).
- On launch: `GET /auth/me` → hydrate `user` + `tenant` (drives `businessType`, `whatsappConnected`, `outOfWindowMessagesEnabled`).
- Password change (`POST /auth/change-password`), profile edit (`PATCH /auth/profile`).

### 6.2 Dashboard / Overview
- `GET /dashboard/stats` → stat cards (SERVICE: Total Bookings, Today's Bookings, Active Chats, Customers; PRODUCT: Sales, Orders, Active Chats, Customers) + recent activity.
- Pull-to-refresh; background refetch on focus.

### 6.3 Bookings (SERVICE core) ⭐
- List with filters/search (`GET /bookings`, `GET /bookings/upcoming`), detail (`GET /bookings/:id`).
- Create (`POST /bookings`), update (`PATCH /bookings/:id`), cancel (`POST /bookings/:id/cancel`).
- Show `status` (PENDING_PAYMENT/CONFIRMED/CANCELLED/COMPLETED/NO_SHOW) and `paymentStatus`.
- **Payment link:** initialize (`POST /payments/bookings/:id/initialize`) → open `paymentAuthorizationUrl` in in-app browser → **refetch** on return (payments are webhook-driven).
- "Today" view is the highest-value default for a phone.

### 6.4 Conversations / WhatsApp Inbox ⭐ (the heart of the app)
- Inbox (`GET /conversations`), needs-reply badge from `lastMessageDirection === INBOUND`.
- Thread (`GET /conversations/:id/messages`, paginated `before`/`limit`); send (`POST /conversations/:id/messages`).
- Human-takeover controls: `resume-bot`, `activate-human`, `assign`; queues `pending`, `human-active`.
- **Composer must enforce the 24-hour window:** if `lastInboundAt` > 24h, disable free-form input, explain why, and offer sending an **approved template** instead. Handle **402** (quota exhausted) with an upgrade prompt.
- Real-time: **push on inbound message** + poll open thread (5s) / inbox (10s) while focused (until G3 ships WebSocket).

### 6.5 Services & Availability (SERVICE)
- Services CRUD (`GET/POST/PATCH/DELETE /services`, toggle active).
- Working hours (`GET/PUT /availability/hours`, `PATCH /availability/hours/:day`) and blackout dates (`GET/POST/DELETE /availability/blackouts`) — "block a day off" is a common phone task.
- Availability slots (`GET /availability/slots`) used when creating a booking.

### 6.6 WhatsApp Connection
- Status (`GET /whatsapp/status`), connect via Embedded Signup (**G6**), manual connect (`POST /whatsapp/connect`), disconnect, send test (`POST /whatsapp/send-test`).
- Prominent "bot live / not connected" indicator — owners must know at a glance.

### 6.7 Templates
- CRUD (`GET/POST/PATCH/DELETE /templates`). Lower frequency; include but secondary.

### 6.8 Notifications ⭐
- Feed (`GET /notifications`), unread badge (`GET /notifications/unread-count`), mark read / mark-all.
- **Native push** (depends on **G2**) for NEW_BOOKING, BOOKING_CANCELLED, NEW_CONVERSATION, SYSTEM (e.g. "WhatsApp not connected", "reconnect Calendar", quota exhausted). Tapping a push deep-links to the relevant booking/chat.

### 6.9 Settings & Billing
- Profile, business info, automated-reminders toggle (`outOfWindowMessagesEnabled`).
- **Plan & Usage** (`GET /billing/status`): plan, trial/past-due banners, WhatsApp quota bar; subscribe/cancel (`POST /billing/subscribe|cancel`) via Paystack hosted page.
- Integrations (Calendar/Paystack/SMS/Email connect): show **status**; the key-entry/OAuth flows can defer to web or use in-app browser. Notification preferences (push toggles) are mobile-only additions.

### 6.10 PRODUCT mode (gated)
- Products (`/products`), Orders (`/orders`) mirror the web screens, **only when `businessType === PRODUCT` and the product feature flag is on** (mirror [apps/web/src/lib/feature-flags.ts](../apps/web/src/lib/feature-flags.ts)). Build SERVICE-first; keep PRODUCT screens behind the same flag.

---

## 7. Navigation / Information Architecture
- **Bottom tabs (SERVICE):** Overview · Bookings · Chats · Services · More(Settings).
- **Bottom tabs (PRODUCT):** Overview · Orders · Chats · Products · More.
- Stacks under each tab; global notification bell in header; deep links from push (`bookly://conversations/:id`, `bookly://bookings/:id`).

## 8. Non-Functional Requirements
- **Security:** tokens in `expo-secure-store` only; no logging tokens; certificate-pinning optional; honor 15-min access-token TTL with silent refresh.
- **Offline:** TanStack Query cache for read screens; queue nothing destructive offline in v1 (show offline banner).
- **Performance:** cold start < 3s; chat thread scroll 60fps; image/message pagination.
- **Accessibility:** dynamic type, sufficient contrast, screen-reader labels.
- **Observability:** Sentry (matches API), basic analytics on key funnels (login, connect WhatsApp, reply, create booking).
- **Localization:** en first; currency from `tenant.paymentCurrency`; timezones from `tenant.timezone`.

## 9. Release Phasing
- **Phase 0 — Backend enablers:** G1 (mobile refresh) + G2 (device tokens + Expo Push). *Blockers.*
- **Phase 1 — MVP core:** Auth, Dashboard, Bookings, Conversations (with 24h/quota rules), Notifications + push, WhatsApp status. SERVICE mode.
- **Phase 2 — Parity:** Services, Availability, Templates, Settings + Plan/Usage, payment links, WhatsApp connect (Embedded Signup on mobile, G6).
- **Phase 3 — PRODUCT mode + Staff:** Products/Orders behind flag; G5 staff provisioning; assignment.
- **Phase 4 — Polish:** WebSocket live chat (G3), offline improvements, deep-link coverage, store submission (EAS Submit).

## 10. Success Metrics
- % of owner replies sent from mobile vs web.
- Median time-to-first-reply on inbound customer messages (should drop with push).
- DAU/WAU of owners; push opt-in rate; crash-free sessions > 99.5%.

## 11. Risks & Open Questions
- **Refresh-token model (G1)** must be settled before build — decide body vs header, and mobile-client detection.
- **Push provider:** Expo Push (fast) vs direct FCM/APNs (more control). Recommendation: start with Expo Push.
- **Embedded Signup on native (G6):** validate the WebView `code` capture early; manual-connect is the fallback.
- **Staff multi-user (G5):** confirm whether v1 needs it or OWNER-only is acceptable at launch.
- **App Store review:** apps that send messaging need clear privacy disclosures; reuse the live privacy policy (`/privacy`).

---

## Appendix A — API Endpoint Map (mobile-relevant)

Base: `https://bookly.ikieguy.online/api` · Auth: `Authorization: Bearer <accessToken>` unless noted.

- **auth:** `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/refresh` (cookie today — see G1), `POST /auth/logout`, `PATCH /auth/profile`, `POST /auth/change-password`
- **dashboard:** `GET /dashboard/stats`
- **bookings:** `GET /bookings`, `GET /bookings/upcoming`, `GET /bookings/:id`, `POST /bookings`, `PATCH /bookings/:id`, `POST /bookings/:id/cancel`, `GET /bookings/by-reference/:ref`, `GET /bookings/customer/:phone`
- **conversations:** `GET /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages` (60/min/tenant), `POST /conversations/:id/resume-bot|activate-human|assign`, `GET /conversations/pending|human-active`
- **services:** `GET /services`, `/services/active`, `/services/categories`, `GET /services/:id`, `POST /services`, `PATCH /services/:id`, `DELETE /services/:id`, `POST /services/:id/toggle`
- **availability:** `GET/PUT /availability/hours`, `PATCH /availability/hours/:dayOfWeek`, `GET/POST /availability/blackouts`, `DELETE /availability/blackouts/:id`, `GET /availability/slots`
- **whatsapp:** `GET /whatsapp/status`, `POST /whatsapp/connect`, `POST /whatsapp/embedded-signup`, `POST /whatsapp/disconnect`, `POST /whatsapp/send-test`
- **templates:** `GET /templates`, `GET /templates/:id`, `POST /templates`, `PATCH /templates/:id`, `DELETE /templates/:id`
- **notifications:** `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/mark-all-read`
- **billing:** `GET /billing/status`, `POST /billing/subscribe`, `POST /billing/cancel`
- **payments (tenant's customer payments):** `POST /payments/bookings/:id/initialize`, `POST /payments/orders/:id/initialize`, `GET /payments/status`, `POST /payments/connect|disconnect`
- **products (PRODUCT, flagged):** `GET /products`, `/products/active`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `PATCH /products/:id/toggle|stock`, `DELETE /products/:id`
- **orders (PRODUCT, flagged):** `GET /orders`, `/orders/recent`, `/orders/stats`, `GET /orders/:id`, `POST /orders`, `PATCH /orders/:id`, `POST /orders/:id/cancel`
- **customers:** `GET /customers`, `GET /customers/stats`
- **integrations:** `GET /calendar/status`, `POST /calendar/disconnect`, `GET /email/status`, `POST /email/connect|disconnect`, `GET /sms/status`, `POST /sms/connect|disconnect`
- **NEW (to build):** `POST /devices/register`, `DELETE /devices/:token` (G2)

## Appendix B — Reference files
- API entry & CORS/rate-limit: [apps/api/src/index.ts](../apps/api/src/index.ts)
- Auth routes & token issuance: [apps/api/src/routes/auth/index.ts](../apps/api/src/routes/auth/index.ts)
- Auth decorators/JWT: [apps/api/src/plugins/auth.ts](../apps/api/src/plugins/auth.ts)
- Web auth/api client to mirror: [apps/web/src/lib/auth.tsx](../apps/web/src/lib/auth.tsx), [apps/web/src/lib/api.ts](../apps/web/src/lib/api.ts)
- Tab set / businessType gating: [apps/web/src/components/dashboard/bottom-tab-bar.tsx](../apps/web/src/components/dashboard/bottom-tab-bar.tsx), [apps/web/src/lib/feature-flags.ts](../apps/web/src/lib/feature-flags.ts)
- Data model: [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma)
- Notifications/worker: [apps/api/src/services/notification.ts](../apps/api/src/services/notification.ts), [apps/api/src/services/notification-worker.ts](../apps/api/src/services/notification-worker.ts)
- Bot & takeover: [apps/api/src/services/whatsapp-bot.ts](../apps/api/src/services/whatsapp-bot.ts), [apps/api/src/services/human-takeover.ts](../apps/api/src/services/human-takeover.ts)
