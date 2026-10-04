-- One stored row per WhatsApp message id per conversation.
--
-- Meta delivers webhooks at-least-once, and the old read-then-insert
-- duplicate check in the webhook handler is racy: two deliveries of the same
-- inbound message processed concurrently could both pass the check and both
-- insert. The unique index below closes that race at the database; the
-- handler catches P2002 on it and treats the delivery as already handled.
--
-- whatsappMsgId is nullable. Postgres treats NULLs as distinct in a unique
-- index (the default NULLS DISTINCT behaviour), so any number of rows with a
-- NULL id in the same conversation remain allowed.

-- Remove duplicate INBOUND rows that the race already let in, or
-- CREATE UNIQUE INDEX below would fail on them. Keep the earliest row per
-- (conversationId, whatsappMsgId), ties broken by id, since that is the one
-- the bot replied to. Only INBOUND rows are touched: an inbound duplicate is a
-- second copy of the same customer message and carries nothing new. OUTBOUND
-- rows hold delivery status and billing data, and their wamids are issued
-- once per send by Meta, so they are left alone. If an outbound duplicate
-- ever exists, the index creation fails loudly so a person can look, rather
-- than this migration silently deleting billing rows. Nothing has a foreign
-- key to "Message", so the delete cascades nowhere.
DELETE FROM "Message"
WHERE "id" IN (
    SELECT "id"
    FROM (
        SELECT
            "id",
            ROW_NUMBER() OVER (
                PARTITION BY "conversationId", "whatsappMsgId"
                ORDER BY "createdAt" ASC, "id" ASC
            ) AS rn
        FROM "Message"
        WHERE "direction" = 'INBOUND'
          AND "whatsappMsgId" IS NOT NULL
    ) ranked
    WHERE ranked.rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Message_conversationId_whatsappMsgId_key"
    ON "Message"("conversationId", "whatsappMsgId");
