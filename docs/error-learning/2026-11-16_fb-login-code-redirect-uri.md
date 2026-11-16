# Error Learning Record

## Date
2026-11-16

## Error Category
[ ] Architectural  [ ] Security-Relevant  [x] Integration Contract Violation

## What Went Wrong
Connecting Messenger/Instagram on booklygh.com/channels got as far as the Facebook window, then
Bookly showed "Could not read your Facebook Pages. Make sure you granted access to the Page you
want to use." The person had granted access. The API log showed the real failure at step
`token_exchange`:

    http_400: Error validating verification code. Please make sure your redirect_uri is
    identical to the one you used in the OAuth dialog request

The page called `FB.login({ response_type: 'code', override_default_response_type: true, scope })`
and the API exchanged that code at `/oauth/access_token` with no `redirect_uri`.

## Root Cause
We copied the WhatsApp Embedded Signup pattern (code plus no redirect_uri), which works only for
Facebook Login for Business with a `config_id`. For a classic scope-based `FB.login`, the JS SDK
sets the dialog's `redirect_uri` to its own one-off `staticxx.facebook.com/x/connect/xd_arbiter`
handler URL, with a random callback id. The code is bound to that URL, and the server can never
reproduce it, so the exchange can never succeed.

## Corrected Implementation
The browser sends the short-lived user token, and the server swaps it with the app secret:

```ts
// apps/web/src/app/channels/page.tsx
facebookLogin(fb, { scope: FB_SCOPES }).then(readPages, …);
// readPages → api.post('/channels/facebook/pages', { accessToken: response.authResponse?.accessToken })
```

```ts
// apps/api/src/services/meta-pages.ts — discoverPages(userAccessToken)
tokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
tokenUrl.searchParams.set('client_id', config.whatsapp.appId);
tokenUrl.searchParams.set('client_secret', config.whatsapp.appSecret);
tokenUrl.searchParams.set('fb_exchange_token', userAccessToken);
// then GET /me/accounts with the long-lived token → Page tokens that do not expire
```

The tests are in `meta-pages.test.ts` (exchange grant, long-lived token used for `/me/accounts`,
refused token) and `channels.test.ts` (the route takes `accessToken` and never returns Page tokens).

## Reasoning Behind the Correction
- This is the flow Meta documents for long-lived Page tokens.
- `fb_exchange_token` needs this app's secret, and Meta only exchanges tokens issued to this app,
  so a token from another app is refused.
- Page tokens read with a long-lived user token do not expire, so a connected Page keeps working.
- The user token is used once and never stored; Fastify's default logger does not record bodies.

## Extracted Rule
In apps/web and apps/api, for a classic `FB.login` with `scope` and no `config_id` (Channels:
Messenger and Instagram), never request `response_type: 'code'` and exchange it on the server.
Send `authResponse.accessToken` to the API and swap it with `grant_type=fb_exchange_token`,
because the JS SDK binds codes to a one-off xd_arbiter redirect_uri. The code-without-redirect_uri
exchange is only valid for Facebook Login for Business with a `config_id` (WhatsApp Embedded Signup).

## Recurrence Risk
[x] First occurrence
[ ] Has appeared before — ESCALATE TO ARCHITECTURAL REVIEW
