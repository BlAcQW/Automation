# Error Learning Record

## Date
2026-10-11

## Error Category
[ ] Architectural  [x] Security-Relevant  [x] Integration Contract Violation

## What Went Wrong
A TURBO customer messaged +233 50 206 3549 and never got a reply. Their WhatsApp
uses a username with the phone number hidden, so Meta's webhook carried
`messages[].from_user_id` (a business-scoped user id, BSUID) and `contacts[].user_id`
+ `profile.username`, but **no** `messages[].from` and no `contacts[].wa_id`.

`processMessage` read `message.from` as the customer's identity, so
`resolveConversation` got `externalId: undefined` and Prisma threw
("Argument `externalId` is missing"). The inbox row was retried and failed every
time; 9 messages over ~30 minutes went unanswered. The per-customer lock key also
became `…:WHATSAPP:undefined`, which would have serialised every such sender
behind one lock.

## Root Cause
The webhook contract was assumed fixed: "every WhatsApp sender is a phone number,
and that number is Meta-verified". The type said `from: string` (required), and the
phone was used for three different jobs at once — conversation identity, stored
`customerPhone`, and reply address (`to:`). Meta's 2026 username rollout broke the
assumption: identity is now "phone OR BSUID", and replying to a BSUID needs the
Cloud API `recipient` field, not `to`.

The security half: several places treat any phone on a WhatsApp conversation as
verified (customer linking, TURBO account lookup, `isPhoneVerified`). For a
username-only customer, any number on the conversation was typed by them, so it is
only a claim — trusting it would let them open someone else's account/bookings.

## Corrected Implementation
- `services/whatsapp-identity.ts`: `inboundSenderId(m) = m.from || m.from_user_id`,
  `inboundSenderPhone(m)` (only a real `from`), `isWhatsAppPhoneId`, and
  `whatsappDestination(id)` → `{ to }` for a phone, `{ recipient }` for a BSUID.
- Webhook: types make `from` optional and add `from_user_id`, `contacts[].user_id`,
  `profile.username`, `statuses[].recipient_user_id`; the sender's own contacts entry
  is matched; messages with no id at all are skipped with a warning.
- Conversation keyed on the sender id; `customerPhone` only from `from`; reply
  address = `externalId` everywhere (bot/flows via `buildTextRequest`, staff inbox
  text/media/rich sends).
- Trust: `linkCustomerOnInbound` and `resolveConversationCustomer` refuse when the
  WhatsApp `externalId` is not a phone; `AgentContext.phoneVerified=false` for a
  BSUID sender, and `isPhoneVerified` honours it.
- TURBO: `turbo.balance` returns `needs_phone: 'yes'`; the flow (v2) explains and
  hands the chat to the team instead of "something went wrong".
- Tests: `whatsapp-identity.test.ts`, `routes/whatsapp/username-sender.test.ts`,
  `routes/whatsapp/inbound-link-bsuid.test.ts`, rides `flow-actions.test.ts`.
  Commit b4cdac0.

## Reasoning Behind the Correction
Identity, phone and address are different facts and must be separate values. The
conversation must be keyed by whatever stable id Meta gives (phone or BSUID) so a
customer is always reachable; the phone is only trusted when Meta reported it as the
sender. Sending to `externalId` via one helper keeps every send path consistent with
the key.

## Extracted Rule
In Bookly's WhatsApp webhook handling (apps/api), never read `messages[].from` or
`contacts[].wa_id` directly as the sender: use `inboundSenderId` (phone or BSUID) as
the conversation key and reply address, send via `whatsappDestination(externalId)`
(`recipient` for a BSUID), and treat a phone as verified only when
`isWhatsAppPhoneId(conversation.externalId)` — a number on a BSUID conversation is a
typed claim and must never link or look up a Customer.

## Recurrence Risk
[x] First occurrence
[ ] Has appeared before — ESCALATE TO ARCHITECTURAL REVIEW
