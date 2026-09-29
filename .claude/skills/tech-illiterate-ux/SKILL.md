---
name: tech-illiterate-ux
description: UI and copy rules for Bookly's actual users — salon owners, barbers, nail techs and small clinics in Ghana and West Africa who run their business from a phone and have never configured software. Use when designing or reviewing ANY tenant-facing screen, flow, error message, empty state or piece of copy, and especially for money, onboarding and settings. Covers naming, defaults, error recovery, trust in payment flows and the specific ways well-built software still fails a non-technical owner.
---

# Designing for someone who has never configured software

Bookly's user runs a three-chair salon from her phone between clients. She is
extremely competent at her job and has never once wanted to know what an API
key is. Every screen is competing with a notebook that already works.

---

## The test that settles most arguments

> Could she finish this on a cracked phone, one-handed, with a client in the
> chair, without asking anyone what a word means?

If not, it is not done. "Technically it's all there" is not done.

## Never make her fetch something from elsewhere

The single biggest failure mode is a screen that asks her to go to another
website, create an account, find a value and paste it back. She will not do it.
She will not come back.

- **No API keys, secret keys, tokens, IDs or webhook URLs on a tenant screen.**
  If a feature needs one, the platform supplies it. That is a product decision,
  not a shortcut.
- If an external step is genuinely unavoidable, do it *for* her through a
  guided flow (Facebook Login rather than "paste your Page ID"), and expect the
  step to be where most people drop out.
- Ask only for things she already knows without looking: her phone number, her
  MoMo number, her prices, her opening hours.

## Say what it does, never what it is

Name things by the outcome she recognises, in the words she already uses.

| Never | Say |
|---|---|
| Payment gateway | How you get paid |
| API credentials | — (do not surface at all) |
| SMS provider / sender ID | Text messages |
| Webhook | — (do not surface at all) |
| Payout / settlement | Money out, or Send to my MoMo |
| Concurrent capacity | How many customers at the same time |
| Authentication failed | That password didn't match |
| Sync | Keep my calendar up to date |

Currency in her currency, in her format. Times in her timezone, written the way
she says them ("Tomorrow, 2pm"), never ISO.

## Defaults do the work

Every setting she has to understand is a setting that goes unset and a feature
that never gets used.

- Ship a **safe, sensible default for everything**, so the product works fully
  without her opening settings once.
- Settings exist to *change* a working default, never to switch something on
  for the first time.
- If a default cannot be safe, the feature is not ready to ship to this user.

## Money needs more reassurance than anything else

Where money is involved she is right to be suspicious, and a slick screen makes
that worse, not better.

- Show the number **before** asking her to commit: exact amount, exact
  destination, exact fee, exact arrival time.
- State the destination in her terms: *"MTN MoMo · 024 ••• 4567 · Ama Boateng"*.
  She should recognise it without decoding it.
- **Never use jargon for an amount.** Not "available balance", but *"Ready to
  withdraw"*. Not "pending settlement", but *"Still clearing — ready Tuesday"*.
- Tell her when it arrives, and then tell her again when it has. Silence after
  a money action reads as theft.
- Irreversible money actions get a confirmation that restates the amount and
  destination in full.

## Errors must say what to do next

An error she cannot act on is worse than no error, because it ends the session.

- Name what happened in plain words, then **the single next action**.
- Never show a provider's raw error, a code, or a stack trace.
- If it is our fault, say so and say we are on it. If it needs her, be
  specific: *"That number already has WhatsApp on it. Use a different number,
  or delete WhatsApp on that phone first."*
- If the action can simply be retried, offer the retry as a button rather than
  describing it.

## Progress and state must be visible without reading

- One clear status per thing: **working / needs you / not set up.** Three
  states, colour plus a word, never colour alone.
- Multi-step flows say where she is and how much is left.
- Never leave a screen silent after a tap. Something must move within 100ms.
- Empty states say what will appear here and how to make it happen, never just
  "No data".

## Phone first, and a bad phone at that

- Design at **360px wide** and check nothing overflows.
- Tap targets **44px minimum**, spaced so a thumb cannot hit two.
- Assume a slow, intermittent connection: optimistic UI where safe, clear
  retry where not, and never a spinner with no timeout.
- Assume the screen is cracked and the sun is bright — real contrast, not grey
  on grey.

## Language and literacy

- Short sentences. One idea each. No nested clauses.
- No idioms, no cleverness, no puns — they do not survive a second language.
- Numbers as digits (**3**, not "three").
- Read every string aloud. If it sounds like a form, rewrite it as a sentence
  she would hear from a person.

## Review checklist

- [ ] No key, token, ID or URL asked of the user anywhere
- [ ] Every label names an outcome, not a mechanism
- [ ] Works fully on defaults, with settings unopened
- [ ] Money screens show amount, destination and timing before commit
- [ ] Every error names one concrete next action
- [ ] Status is one of three plain states, never colour alone
- [ ] Usable at 360px, 44px targets, high contrast
- [ ] Every string readable aloud to a non-technical person without wincing
