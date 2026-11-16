# Error Learning Record

## Date
2026-11-16

## Error Category
[ ] Architectural  [ ] Security-Relevant  [x] Integration Contract Violation

## What Went Wrong
On booklygh.com/channels, clicking Connect for Facebook Messenger or Instagram turned both
buttons to "Connecting…" and they stayed that way. No Facebook window opened and Bookly's API
never received a login code. Chrome's console showed, from Meta's SDK bundle:

    Uncaught t {message: 'Expression is of type asyncfunction, not function'}

The Channels page called `fb.login(async (response) => { … }, options)`. This had been hidden
until commit 03b4f55, because before then the page never loaded the SDK at all.

## Root Cause
We assumed `FB.login` accepts any callable. Meta's SDK type-checks its arguments with
`Object.prototype.toString`, which reports an `async` function as `AsyncFunction`. It throws
before opening the popup. The throw happened after `setConnecting(true)` and inside the click
handler, so nothing reset the button.

## Corrected Implementation
`apps/web/src/lib/facebook-sdk.ts` gains one wrapper that always hands Meta a plain function.
Pages await the promise instead of passing their own callback:

```ts
export function facebookLogin(sdk: FacebookSdk, options: Record<string, unknown>): Promise<FacebookLoginResponse> {
    return new Promise<FacebookLoginResponse>((resolve) => {
        sdk.login(function onLogin(response) {
            resolve((response ?? {}) as FacebookLoginResponse);
        }, options);
    });
}
```

```ts
// channels/page.tsx — still called synchronously from the click
facebookLogin(fb, { response_type: 'code', override_default_response_type: true, scope: FB_SCOPES })
    .then(readPages, () => {
        setConnecting(false);
        setError('Facebook login could not open. Refresh the page and try again.');
    });
```

`facebook-sdk.test.ts` uses a fake SDK that applies Meta's own type check, so an async
callback fails the test the way it fails in the browser.

## Reasoning Behind the Correction
- The wrapper satisfies Meta's contract in one place, so no page can pass an async callback again.
- The Promise executor runs synchronously, so `sdk.login` still runs inside the click and the
  popup is not blocked.
- A throw from the SDK rejects the promise, so the button always leaves "Connecting…".

## Extracted Rule
In apps/web, never pass a callback to Meta's JS SDK (`FB.login`, `FB.getLoginStatus`, `FB.api`)
directly. Call `facebookLogin()` from `src/lib/facebook-sdk.ts`, or give the SDK a plain
non-async `function`, because the SDK throws "Expression is of type asyncfunction, not function"
for `async` callbacks and no popup opens.

## Recurrence Risk
[x] First occurrence
[ ] Has appeared before — ESCALATE TO ARCHITECTURAL REVIEW
