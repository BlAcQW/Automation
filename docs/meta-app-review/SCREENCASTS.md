# Meta App Review — Instagram and Messenger: setup and screencasts

The background, use-case text and timeline are in
[futurefeature.md](../../futurefeature.md) section 0. This file is the
hands-on part: the dashboard settings, the accounts you need, and exactly what
to film for each permission.

## Before you record (one-off)

**Meta app dashboard** (the same app as WhatsApp):

1. Add the products **Messenger** and **Instagram** (Instagram API with
   Facebook Login) if they are not listed.
2. Webhooks: the callback URL is the one WhatsApp already uses,
   `https://bookly.ikieguy.online/api/whatsapp/webhook`, with the same verify token
   (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
   - Object **Page**: subscribe `messages` and `messaging_postbacks`.
   - Object **Instagram**: subscribe `messages`.
3. **Facebook Login** (or Facebook Login for Business) → Settings: "Login with
   the JavaScript SDK" = Yes; "Allowed domains for the JavaScript SDK" and
   "Valid OAuth redirect URIs" include `https://bookly.ikieguy.online`. The Channels
   page uses the same app ID as WhatsApp (`NEXT_PUBLIC_WHATSAPP_APP_ID`).
4. App settings → Basic: Privacy Policy URL `https://bookly.ikieguy.online/privacy`,
   Terms of Service URL `https://bookly.ikieguy.online/terms`, User data deletion →
   "Data deletion instructions URL" `https://bookly.ikieguy.online/privacy#data-deletion`,
   app icon and category set.

**Accounts**:

| Who | What it needs |
|---|---|
| Your business Page + Instagram professional account | The Instagram account linked to the Page. In the Instagram app: Settings → Messages and story replies → Message controls → Connected tools → **Allow access to messages** (if off, nothing arrives and nothing errors) |
| A second Facebook account (the "customer") | A **Tester** role on the Meta app (App roles → Roles), so it can message the Page and Instagram while the app is in development mode |
| The reviewer | A Bookly login with nothing connected: `cd apps/api && npx tsx scripts/create-reviewer-account.ts --api https://bookly.ikieguy.online/api --web https://bookly.ikieguy.online --email meta-review@<your-domain>`. Paste what it prints into "Notes for reviewer". |

**The 30-day rule**: at least one real call with each permission must have
happened in the 30 days before you submit, and it takes up to 2 days to show
under App Review → Permissions. Recording the videos below with your own Page
does exactly that, so record first, wait 2 days, then submit.

## Recording rules (why most submissions fail)

- One video per permission. Each must show that permission being used, not a
  tour of Bookly.
- Start every video **signed out**: sign in to Bookly on camera.
- The **Facebook consent screen with the permissions listed must be on camera**
  in every video (disconnect first so it shows again: Channels → Disconnect on the card).
- English, 1080p, visible cursor, no audio needed. Add short captions at the
  key moments (the brackets below).
- 1–3 minutes each. Don't cut out waiting for a message: a jump looks staged.

## Shot lists

### 1. `pages_show_list`: choose which Page is the business

1. Sign in to Bookly. Open **Channels**.
2. On the **Instagram** or **Facebook Messenger** card click **Connect** (one
   connection covers both: they share the Page).
3. Facebook consent screen → caption *"pages_show_list: Bookly lists the
   Pages this person manages"* → continue.
4. Bookly shows **"Which Page is your business?"** with the Page list →
   caption *"The owner picks the Page for their business"* → pick the Page.
5. Channels shows **Connected** with the Page name on the Messenger card.

### 2. `pages_manage_metadata`: subscribe the Page to our webhook

1. Same opening as 1 (sign in, Channels, Connect, consent screen visible).
2. Pick the Page → caption *"pages_manage_metadata: Bookly subscribes this Page
   to its messaging webhook so it receives the business's messages"*.
3. Show Channels: the Messenger card **Connected** with the Page name.
4. From the customer account, send the Page a message on Messenger → it
   appears in Bookly **Conversations** → caption *"Delivered through the Page
   subscription"*.
5. Click **Disconnect** → caption *"Disconnecting unsubscribes the Page and
   deletes the token"*.

### 3. `pages_messaging`: receive and answer Messenger messages

1. Sign in, Channels, Connect, consent screen visible, pick the Page.
2. Phone or second browser as the customer: open the Page on Messenger and
   send *"Hi, can I book a haircut tomorrow?"*.
3. The assistant's reply arrives in Messenger → caption *"pages_messaging:
   Bookly replies on behalf of the business"*.
4. Back in Bookly: **Conversations** shows the thread labelled **Messenger**.
5. A staff reply typed in Bookly → it arrives in Messenger → caption *"Staff
   can take over and reply from Bookly"*.

### 4. `instagram_basic`: read the linked Instagram professional account

1. Sign in, Channels, Connect, consent screen visible.
2. Pick the Page → the **Instagram** card shows **Connected** with the
   account's @username →
   caption *"instagram_basic: Bookly reads the Instagram professional account
   linked to the Page (ID and username only)"*.

### 5. `instagram_manage_messages`: receive and answer Instagram DMs

1. Sign in, Channels, Connect, consent screen visible, pick the Page; show
   Instagram connected.
2. As the customer, send the business's Instagram account a DM: *"Hi, are you
   open on Saturday?"*.
3. The assistant's reply arrives in Instagram → caption
   *"instagram_manage_messages: Bookly answers Instagram DMs for the
   business"*.
4. Bookly **Conversations** shows the thread labelled **Instagram** with the
   customer's @username.
5. Reply from Bookly as staff → the reply arrives in the Instagram DM →
   caption *"Staff can take over on Instagram too"*.

## Submitting

- App Review → Permissions and features → request **Advanced Access** for all
  five together: `pages_messaging`, `instagram_manage_messages`,
  `instagram_basic`, `pages_show_list`, `pages_manage_metadata`. Nothing else.
- For each, paste the matching sentence from the use-case text in
  futurefeature.md and attach its video.
- Notes for reviewer: the output of `create-reviewer-account.ts`.
- After approval, switch the app to **Live** if it is not already.

If rejected: read the reason literally, fix only that, and re-record only the
affected video. The most common reasons are a missing consent screen, a video
that does not isolate the permission, and a privacy policy that doesn't name
the product (now fixed: it names Instagram, Facebook and Messenger and has a
data deletion section).
