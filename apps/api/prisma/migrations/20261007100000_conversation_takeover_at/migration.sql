-- The handoff code has always written Conversation.takeoverAt, but the column
-- never existed in any migration, so every handoff to a human threw at
-- runtime. Additive; existing human-active conversations keep NULL.
ALTER TABLE "Conversation" ADD COLUMN "takeoverAt" TIMESTAMP(3);
