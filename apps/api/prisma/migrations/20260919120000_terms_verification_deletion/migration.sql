-- Launch-readiness fields. All nullable: nothing about existing rows changes.
ALTER TABLE "User"
    ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "Tenant"
    ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);
