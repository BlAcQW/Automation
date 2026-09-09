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
