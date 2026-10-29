# Active Rules — Bookly (Automation)

Rules extracted from this project's own error-learning records. **Scanned before
every code-generation pass.** Format: `RULE-N | Category | one specific, testable rule`.

Categories: Architectural · Security · Integration · Operational

These are Bookly's. Lessons that genuinely apply to more than one product go to the
shared register at [/root/home/error-learning](../../../error-learning/ACTIVE_RULES.md)
instead, and are referenced from here rather than copied.

RULE-1 | Integration | In apps/api WhatsApp webhook handling, never use `messages[].from` / `contacts[].wa_id` as the sender: key conversations and reply via `inboundSenderId` + `whatsappDestination(externalId)` (Cloud API `recipient` for a BSUID), because customers with WhatsApp usernames arrive with only `from_user_id`. (2026-10-11_whatsapp-sender-without-phone.md)
RULE-2 | Security | Treat a WhatsApp phone as verified only when `isWhatsAppPhoneId(conversation.externalId)`; on a BSUID conversation any number was typed by the customer and must never link, create or look up a Customer, TURBO account, booking or order. (2026-10-11_whatsapp-sender-without-phone.md)
RULE-3 | Architectural | In /root/home/Automation git worktrees, never symlink the whole apps/api/node_modules and never run npm install or a default `prisma generate`: make apps/api/node_modules a real folder, copy @prisma/client into it, and generate with PRISMA_GENERATE_SKIP_AUTOINSTALL=true and an explicit --schema, because the live bookly-api loads the shared node_modules and .prisma/client. (2026-10-29_worktree-symlinked-node-modules.md)
