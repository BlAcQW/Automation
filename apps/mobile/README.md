# Bookly Mobile (Expo)

Cross-platform (iOS + Android) owner/staff app for Bookly, built with Expo + Expo Router.
See the full plan in [../../docs/MOBILE_APP_PRD.md](../../docs/MOBILE_APP_PRD.md).

## What's in this first slice
- Auth: **login → dashboard**, tokens in `expo-secure-store`, `X-Client: mobile` header so the API
  returns/accepts the refresh token in the body (mobile refresh flow — backend G1).
- **401 → refresh → retry** interceptor (`src/api/client.ts`), single-flight, mirrors the web client.
- **Push registration** on login (`src/push/register.ts` → `POST /devices/register`, backend G2).
- Bottom tabs (Overview · Bookings · Chats · Services · More), labels switch for PRODUCT tenants.
- Dashboard wired to `GET /dashboard/stats`; other tabs are scaffolded placeholders.

## Run it
```bash
cd apps/mobile
npm install
# Point at the live API (default) or your local API:
# echo 'EXPO_PUBLIC_API_URL=http://<your-LAN-ip>:3001' > .env
npm start        # then press i (iOS) / a (Android), or scan the QR in Expo Go
```
Default API base URL: `https://bookly.ikieguy.online/api` (override with `EXPO_PUBLIC_API_URL`).

> **Push note:** Expo push tokens are only issued on a **physical device** (not simulators). Test push
> on a real phone via Expo Go / a dev build.

## Monorepo note
This package is under the repo's npm workspaces (`apps/*`). If a root `npm install` ever causes Metro
resolution issues with `apps/api`/`apps/web`, install and run this app from its own directory instead
(`cd apps/mobile && npm install`).

## Structure
```
app/                     # Expo Router routes
  _layout.tsx            # providers + auth-gate redirect
  (auth)/login.tsx
  (tabs)/                # Overview, Bookings, Chats, Services, More
src/
  api/client.ts          # axios + mobile refresh interceptor
  auth/{store,context}.ts(x)
  push/register.ts       # device-token registration
  lib/config.ts          # API base URL + client header
  components/Placeholder.tsx
```

## Next build-out (per PRD)
Conversations inbox (24h-window + quota aware), Bookings list/detail + payment links, Services &
Availability CRUD, WhatsApp connect (Embedded Signup on native — G6), Notifications feed + deep
links, Settings/Billing. PRODUCT-mode screens behind the feature flag.
