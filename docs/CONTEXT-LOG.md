# Bookly — Context / Work Log

> **Purpose:** A resumable record of what we're doing on Bookly. If you are a new agent (or a
> different model) picking this up, **read this file top to bottom first** — it tells you the live
> system state, decisions made, what's in progress, and the next steps. Newest entries at the top of
> the Session Log.
>
> **How to use:** Before starting work, read "Current State" + "Open Items". After doing meaningful
> work, add a dated entry to "Session Log" (what changed, why, what's next). Keep secrets OUT of this
> file — reference `.env`, never paste tokens/passwords.

---

## Project at a glance
- **What:** Bookly (internal name BookingFlow) — multi-tenant, WhatsApp-first booking & commerce SaaS.
- **Repo:** `/root/home/Automation` (npm workspaces monorepo). `apps/api` (Fastify+TS+Prisma/Postgres+Redis/BullMQ), `apps/web` (Next.js 14 PWA).
- **Live URL:** https://bookly.ikieguy.online (nginx on this VPS).
- **Owner/GitHub:** BlAcQW · enochhenyo@gmail.com.

## Current State (keep this accurate)
- **Meta:** ✅ **Verified Tech Provider** (as of 2026-09-07). Advanced access to `whatsapp_business_messaging` + `whatsapp_business_management`. Real tenants can now onboard their own WhatsApp numbers via Embedded Signup.
- **Infra / process layout (PM2):**
  - `bookly-api` → port **3001** (nginx `/api/` → 3001).
  - `bookly-web` → port **3006** (nginx `/` → 3006). *Note: moved off 3005 because Donewell's frontend also proxies to 3005 — 3005/3006 was a real port collision. Do not put bookly-web back on 3005.*
  - `pm2 save` done. Both survive restart.
- **Database:** Supabase Postgres (`db.owljuplahkyadmiekymd.supabase.co`), `DATABASE_URL` in `.env`. ⚠️ Free tier — **auto-pauses after ~1 week idle**; when paused the host stops resolving in DNS and `bookly-api` crash-loops (P1001). Fix = resume the project in supabase.com/dashboard, then `pm2 restart bookly-api`.
- **Privacy policy URL:** https://bookly.ikieguy.online/privacy returns 200 (Meta needs this).
- **MCP:** `meta-devtools` added **project-scoped** in [.mcp.json](../.mcp.json) (`https://mcp.facebook.com/devtools`). It connects at CLI level but its tools only load after a Claude session **restart** (a session started before it connected can't call them).

## Key Decisions
- **Mobile app:** React Native (**Expo**), **owner/staff-facing**, **full-parity MVP** (SERVICE-mode first; PRODUCT behind the existing feature flag). PRD written: [docs/MOBILE_APP_PRD.md](./MOBILE_APP_PRD.md).
- **"Avoid Tech Provider" analysis** (now moot since verified, but recorded): options were shared-number, BSP (360dialog/Twilio/Wati), tenant-brings-own-credentials, or SMS-only.
- **WhatsApp rules the product lives by:** 24-hour customer-service window (free-form only within 24h of customer's last message; else approved templates), per-tenant monthly message quota (free 50 / starter 500 / pro 5000; 402 when exhausted), payments are Paystack webhook-driven (open hosted page → refetch).

## Open Items / Blockers
**Mobile backend enablers (from the PRD, Phase 0):**
- **G1 — ✅ DONE (2026-09-09, live).** Mobile refresh via `X-Client: mobile` header; refresh token returned in body + accepted from body + rotated. Web unchanged.
- **G2 — ✅ CORE DONE (2026-09-09, live).** `DeviceToken` model + migration, `/devices` routes, Expo push service, `createNotification` wired into new-booking + cancellation. **Follow-up:** migrate remaining notification sites to `createNotification` (payment-fulfillment, new-conversation, SYSTEM alerts); add tests.
- **G3 — High:** No real-time transport (polling only). Plan: push + smart polling for v1; WebSocket later.
- **G5:** No `STAFF` provisioning endpoint (registration only makes OWNER). Needed for multi-user.
- **G6:** Embedded Signup is web-only (FB JS SDK); needs a native/WebView variant. Manual-connect fallback works.

**Production go-live checklist (post Tech-Provider):**
- Flip Meta app to **Live** mode.
- Verify `.env` uses **live** app creds (`WHATSAPP_APP_ID/SECRET/WEBHOOK_VERIFY_TOKEN/REDIRECT_URI`) and web `NEXT_PUBLIC_WHATSAPP_APP_ID/CONFIG_ID`.
- Confirm webhook `https://bookly.ikieguy.online/api/whatsapp/webhook` verified + `messages` subscribed.
- Real end-to-end: onboard a real business number via Embedded Signup → book over WhatsApp → confirm bot + template messages fire.

## Next Steps (proposed, pending user pick)
1. Build `apps/mobile/` Expo skeleton (nav, auth flow, API client w/ refresh interceptor, tab layout), **or**
2. Scope Phase 0 backend tickets (G1 + G2) first since they gate the app, **or**
3. Production go-live readiness audit for WhatsApp.

## How to resume (for a new agent / different model)
1. Read **Current State**, **Open Items**, **Next Steps** above.
2. Read [docs/MOBILE_APP_PRD.md](./MOBILE_APP_PRD.md) if the task is the mobile app.
3. Check live health: `pm2 list | grep bookly`, `curl -s https://bookly.ikieguy.online/api/health`. If API is down, check the Supabase DB is not paused (DNS resolves for the `DATABASE_URL` host), then `pm2 restart bookly-api`.
4. Continue the chosen Next Step and **append a Session Log entry** when done.

---

## Session Log (newest first)

### 2026-09-10 (later still) — G3 (WebSocket live chat) + G6 (native Embedded Signup)
- **G3 — DONE & LIVE (backend verified).**
  - Backend: `@fastify/websocket@8` installed; `apps/api/src/services/realtime.ts` (in-memory per-tenant pub/sub) + `routes/realtime/index.ts` (`GET /ws`, JWT via `?token=`, access-type only). Registered plugin+route in index.ts. `publish()` wired into `createNotification` (type:'notification') and the WhatsApp webhook inbound message (type:'message', conversationId).
  - nginx: added WS `Upgrade`/`Connection $connection_upgrade` (map already in conf.d) + `proxy_read_timeout 3600s` to bookly `/api/`. Verified: `wss://…/api/ws` upgrades (101) over **HTTP/1.1** (curl over HTTP/2 shows 404 — expected; RN uses HTTP/1.1).
  - Mobile: `src/realtime/useRealtime.ts` connects with the access token, invalidates React Query caches per event, exponential-backoff reconnect; mounted in `app/_layout.tsx` AuthGate. Polling stays as backstop.
  - Tests: `realtime.test.ts` (3) — tenant isolation, cleanup, error-safe. **Full API suite now 175 pass (17 files).**
- **G6 — DONE (WebView flow; needs Meta config + build to run live).**
  - Backend: `completeEmbeddedSignup(code, redirectUri?)` now replays redirect_uri for the native flow; `/whatsapp/embedded-signup` accepts optional `redirectUri`; new public `GET /whatsapp/native-callback` bounces `?code` to `bookly://whatsapp` (verified 302). FB requires an **https** redirect (not a custom scheme), hence the bridge.
  - Mobile: `src/features/whatsapp/useEmbeddedSignup.ts` (expo-web-browser `openAuthSessionAsync` → capture code → POST embedded-signup); "Connect with Facebook" button on `app/whatsapp.tsx` shown when configured, else manual connect. New deps: expo-web-browser. Env: `EXPO_PUBLIC_WHATSAPP_APP_ID`/`_CONFIG_ID`; whitelist the native-callback URL in Meta.
- **Remaining before launch:** `npm install` + run on device (shake out shapes), set the Meta env + redirect whitelist, `eas init`, then `eas build`/`submit`. This effectively closes Phases 0–4.

### 2026-09-10 (later) — Phase 4 (tests, pickers, EAS; G3/G6 assessed)
- **Backend tests — DONE & GREEN (verified here).** Extracted pure helpers and unit-tested them:
  - `apps/api/src/lib/auth-transport.ts` (isMobileClient, extractRefreshToken) + `auth-transport.test.ts` — auth/index.ts now imports these (removed the inline dupes).
  - `apps/api/src/services/push.ts` now exports pure `buildExpoMessages()` + `push.test.ts`.
  - **Full suite: 172 tests pass (16 files)**, incl. 10 new. tsc clean, API rebuilt + `pm2 restart` + health OK. No regressions.
- **Date/time pickers (mobile):** `src/components/ui/DateTimeField.tsx` (@react-native-community/datetimepicker, iOS spinner / Android dialog, HH:MM & YYYY-MM-DD). Availability now uses it for working-hours open/close and blackout date. Added dep to package.json.
- **EAS build/submit:** `apps/mobile/eas.json` (development/preview/production + submit) + README build/ship steps. NOTE: run `eas init` to get `extra.eas.projectId` (also unblocks real push tokens).
- **G3 (WebSocket live chat) — DEFERRED (documented, not built).** Backend has no WS/SSE server; adding one + a native client is large and un-testable in this env. Current behaviour = push (G2) + smart polling (chat 5s / inbox 15s), which is acceptable for v1. Do WS with a live device.
- **G6 (native Embedded Signup) — PARTIAL.** Native **manual-connect** (paste creds → POST /whatsapp/connect) already works in `app/whatsapp.tsx`. Full one-tap FB Embedded Signup on native needs react-native-fbsdk-next or a WebView code-capture + native config; deferred to a real build.
- **Roadmap:** Phases 0–4 essentially complete except the two deferred native items (G3 WS, full G6) which require a device/native build. Remaining before store launch: `eas init`, run the app, fix any real shape mismatches, then `eas build`/`submit`.

### 2026-09-10 — Phase 3 (PRODUCT mode + Staff/G5)
- **Backend G5 — DONE & LIVE.** New `apps/api/src/routes/users/index.ts` (mounted `/users`): `GET /users` (list tenant users), `POST /users` (OWNER-only create STAFF, bcrypt, email-unique), `PATCH /users/:id` (rename / (de)activate, owner-protected, tenant-scoped, audited). tsc clean, built, `pm2 restart bookly-api`, verified 401.
- **PRODUCT mode (mobile):**
  - Products — `src/features/products/ProductsList.tsx` (FAB + toggle) + `ProductForm.tsx`; routes `app/products/new.tsx`, `app/products/[id].tsx`. CRUD via /products.
  - Orders — `src/features/orders/OrdersList.tsx` + `app/orders/[id].tsx` (items, status badges, **advance-status** flow via nextOrderStatus, cancel, wa.me).
  - The **Bookings** and **Services** tabs now branch on `tenant.businessType === 'PRODUCT'` → render Orders / Products (tabs already relabel in `_layout`). Early returns placed AFTER all hooks (rules-of-hooks safe).
- **Team/Staff (mobile):** `app/team.tsx` — list members, owner can add staff + (de)activate. Hooks: useTeam/useAddTeamMember/useUpdateTeamMember. Linked from More.
- **New hooks:** products CRUD/toggle, orders list + status update, team. **New types:** Product, Order/OrderItem/OrderStatus, TeamMember. **New format helpers:** orderStatusLabel/Tone, nextOrderStatus.
- **NOT compile-verified** on mobile (no Expo install here). Verify shapes: `/products`, `/orders` (items[], product.name, totalAmount), `/users` (`{users:[...]}`).
- **Roadmap:** Phase 0/1/2/3 core done. **Phase 4 remaining:** full native Embedded Signup (G6), WebSocket live chat (G3), date/time pickers, tests, EAS build + store submission. PRODUCT screens are gated by businessType but remember the web also gates products behind a feature flag — confirm the tenant is truly PRODUCT before relying on them.

### 2026-09-09 (later still) — Phase 2 UI (parity screens)
- **Services** — tab list with FAB + active toggle (`app/(tabs)/services.tsx`); shared `src/features/services/ServiceForm.tsx` used by `app/services/new.tsx` and `app/services/[id].tsx` (create/edit/delete, validation).
- **Availability** — `app/availability.tsx`: per-day working hours (toggle + open/close time fields, PUT /availability/hours) and blackout dates (list/add/delete). Times/dates are text fields for now (native date/time picker = polish follow-up).
- **Settings + Plan/Usage** — `app/settings.tsx`: profile/business name, automated-reminders toggle (PATCH /auth/profile + refreshUser), plan name + subscription badge + usage bar (GET /billing/status).
- **Templates** — `app/templates.tsx`: read-only list (approved/pending). Registration stays on web.
- **WhatsApp native connect (partial G6)** — `app/whatsapp.tsx` now has a **manual-connect form** (POST /whatsapp/connect) that works on native without the FB SDK. Full one-tap Embedded Signup on native still deferred (needs FB Login SDK / WebView code capture).
- **New primitives:** `Field` (labeled input) + `SwitchRow`. **New hooks:** services CRUD/toggle, working-hours get/save, blackouts, templates, billing status, profile update, whatsapp connect. **New types** in `src/api/types.ts`.
- **More screen** now links to Availability, Templates, WhatsApp, Settings, Notifications.
- **Still NOT compile-verified** (no Expo install here). Verify assumed shapes: `/services`, `/availability/hours` (PUT body `{hours}`), `/billing/status` (usage/limit fields), `/templates`.
- **Phase 2 remaining:** native Embedded Signup (full G6), date/time pickers for availability, PRODUCT-mode screens (Phase 3), tests.

### 2026-09-09 (later) — Phase 1 UI + design system
- **Design system** (grounded via ui-ux-pro-max skill): direction = "Soft UI Evolution"; universal **emerald + warm-slate** palette (rejected the beauty-only pink), **Plus Jakarta Sans + Inter** type, light+dark tokens, 4/8 spacing, 150–300ms motion, **vector icons only** (Ionicons — replaced scaffold emoji). Tokens in `apps/mobile/src/theme/tokens.ts` + `theme/index.tsx` (useTheme, useColorScheme-driven).
- **UI kit** `src/components/ui/`: Text, Button, Card, Badge, Avatar, Screen (safe-area), EmptyState + `AppHeader`. All theme-driven, 44pt targets, pressed feedback.
- **Screens built (Phase 1):**
  - Conversations **inbox** `app/(tabs)/chats.tsx` (needs-reply dot, bot/human badge, poll 15s) + **thread** `app/conversations/[id].tsx` (bubbles, resume-bot, **24h-window composer lock + 402 quota handling**, poll 5s).
  - **Bookings** `app/(tabs)/bookings.tsx` (filter chips, status/payment badges) + **detail** `app/bookings/[id].tsx` (payment link open/create, wa.me deep link).
  - **Notifications** `app/notifications.tsx` (feed, mark-all-read, deep-link to booking/chat) + unread badge on Chats tab.
  - **WhatsApp status** `app/whatsapp.tsx`.
  - Refactored **login**, **dashboard** (WhatsApp strip + stat grid), **tabs** (Ionicons), **more** (profile + nav rows + logout) onto the system. Services = themed Phase-2 placeholder.
- **Data layer:** `src/api/hooks.ts` (TanStack Query) + `src/api/types.ts` (defensive shapes) + `src/lib/format.ts`. Added deps: @expo/vector-icons, expo-font, expo-splash-screen, @expo-google-fonts/{inter,plus-jakarta-sans}.
- **NOT compile-verified** (Expo deps not installed here). Run `cd apps/mobile && npm install && npx expo start`; `npx expo install --fix` will pin versions. Verify assumed response shapes: `/dashboard/stats`, `/conversations` list (lastMessage/lastMessageDirection/lastInboundAt), `/notifications/unread-count`.
- **Next:** Phase 2 (Services/Availability CRUD, Settings/Billing, native Embedded Signup G6) OR verify-run the app and fix install/shape issues first.

### 2026-09-09 — Expo app scaffolded (login → dashboard slice)
- Created **`apps/mobile/`** (Expo SDK 52 + Expo Router + TypeScript). Runnable login→dashboard vertical slice against the live API.
  - Config/build: `package.json`, `app.json`, `tsconfig.json` (`@/*`→`src/*`), `babel.config.js`, `metro.config.js`, `.gitignore`, `README.md`.
  - Auth: `src/auth/store.ts` (SecureStore tokens), `src/auth/context.tsx` (AuthProvider/useAuth), `src/api/client.ts` (axios + **single-flight 401→refresh→retry**, sends `X-Client: mobile`, refresh token in body — uses backend G1).
  - Push: `src/push/register.ts` → `POST /devices/register` on login (backend G2).
  - Routes: `app/_layout.tsx` (providers + auth-gate redirect), `app/(auth)/login.tsx`, `app/(tabs)/_layout.tsx` (tabs relabel for PRODUCT), `app/(tabs)/index.tsx` (Dashboard → `GET /dashboard/stats`), `bookings/chats/services` placeholders, `more.tsx` (profile + logout).
- **NOT verified by compile here** — Expo/RN deps not installed in this env. Run `cd apps/mobile && npm install && npm start`. Push tokens need a physical device + an EAS `projectId` in app config for production.
- **Dashboard stat field names are assumed** (`totalBookings`, `todayBookings`, `activeConversations`, `totalCustomers`) — verify against the real `/dashboard/stats` response and adjust.
- **Next build-out:** Conversations inbox (24h/quota-aware) → Bookings list/detail + payment links → Services/Availability → WhatsApp connect (G6) → Notifications feed + deep links.

### 2026-09-09 — Phase 0 backend (mobile enablers) started & shipped
- **G1 (mobile refresh) — DONE & LIVE.** [apps/api/src/routes/auth/index.ts](../apps/api/src/routes/auth/index.ts): added `isMobileClient()` (detects `X-Client: mobile` header) and `extractRefreshToken()` (cookie → body). Login/register now also return `refreshToken` in the body for mobile; `/auth/refresh` accepts it from the body and **rotates** it for mobile. Web behaviour unchanged (still cookie-only). tsc clean, built, `pm2 restart bookly-api`, verified 401 on no-token.
- **G2 (push notifications) — CORE DONE & LIVE.**
  - Added **`DeviceToken`** model ([apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma)) + migration `apps/api/prisma/migrations/20260909170000_device_tokens/` (applied via `prisma migrate deploy` with DATABASE_URL from root .env; client regenerated).
  - New routes **`POST /devices/register`**, **`DELETE /devices/:token`** ([apps/api/src/routes/devices/index.ts](../apps/api/src/routes/devices/index.ts)), mounted at `/devices` in [index.ts](../apps/api/src/index.ts). Auth-gated (verified 401).
  - New **Expo push service** [apps/api/src/services/push.ts](../apps/api/src/services/push.ts) (`sendPushToTenant`, best-effort, batches of 100, Expo token regex) and central **[apps/api/src/services/notifications.ts](../apps/api/src/services/notifications.ts)** `createNotification()` = create in-app Notification + push.
  - Wired `createNotification` into **NEW_BOOKING** ([bookings/index.ts](../apps/api/src/routes/bookings/index.ts)) and **BOOKING_CANCELLED** ([booking-cancel.ts](../apps/api/src/services/booking-cancel.ts)).
- **G2 remaining (follow-up):** migrate the other notification sites to `createNotification` so they push too — payment-fulfillment confirmation ([payment-fulfillment.ts:117](../apps/api/src/services/payment-fulfillment.ts)), new-conversation, and SYSTEM alerts ([notification-worker.ts](../apps/api/src/services/notification-worker.ts), [calendar.ts](../apps/api/src/services/calendar.ts)). No new Notification schema field (`userId`) — push fans out to ALL tenant devices; per-user targeting is a later refinement.
- **Tests: not yet added** for G1/G2 (auth refresh mobile path, devices register/unregister, push fan-out). Add before considering Phase 0 "done-done".
- **Next:** scaffold the Expo app (`apps/mobile/`) — auth flow using the new mobile refresh, device-token registration on login, tab layout.
- ⚠️ DB password prefix was printed to the terminal during the migration step — rotate the Supabase DB password when convenient.

### 2026-09-07
- **Mobile app PRD written** → [docs/MOBILE_APP_PRD.md](./MOBILE_APP_PRD.md). Decisions: Expo, owner-facing, full parity. Explored API surface, web screens, and data model via 3 agents; captured backend gaps G1–G7. **Next:** user to choose skeleton vs Phase-0 backend vs go-live audit.
- **Created this context log** (`docs/CONTEXT-LOG.md`) so work is resumable across models/sessions.
- **Meta Tech Provider verification confirmed** ✅ — unblocks real tenant onboarding.
- **Added `meta-devtools` MCP** project-scoped ([.mcp.json](../.mcp.json)); authenticated via `/mcp` (tools require a session restart to load).

### Earlier (WhatsApp App Review push — multiple sessions)
- Built understanding of the WhatsApp **App Review** requirements: `whatsapp_business_messaging` (record video of app sending + WhatsApp receiving) and `whatsapp_business_management` (Postman test calls + record creating a template in WhatsApp Manager).
- Confirmed Bookly already had the **manual-connect** path (`POST /whatsapp/connect`) and **send-test** flow (`POST /whatsapp/send-test`) + a "Send Test Message" UI card gated on connection — no new code needed for the messaging demo.
- Guided System User token generation, Postman collection setup, and clarified that **test numbers are pre-registered** (the "register" errors were an unnecessary step) and the **24-hour window** rule.

### Infra fixes (recorded so they aren't repeated)
- Fixed repeated **502s**: bookly-api/web were stopped/crash-looping. Root causes over time: (a) apps never registered in PM2; (b) API crash-loop from **paused Supabase DB**; (c) **port 3005 collision** with Donewell → moved bookly-web to **3006** and updated nginx. All resolved; `pm2 save` done.
