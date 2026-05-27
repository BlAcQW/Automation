/**
 * One-shot: flip the KIM tenant back to SERVICE and reset any conversations
 * stranded mid-product-flow so the bot resumes them cleanly on the next
 * customer message. Run with:
 *
 *   npx tsx scripts/flip-kim-to-service.ts
 *
 * Safe to re-run — all operations are idempotent.
 */

import * as path from 'node:path';
import dotenv from 'dotenv';
// Load the monorepo's .env (lives at the repo root, not at apps/api)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';

const KIM_ID = 'cmp405oy0000aen3eoi6nknhp';
const PRODUCT_BOT_STATES = [
    'VIEW_PRODUCT',
    'BROWSE_PRODUCTS',
    'VIEW_CART',
    'CHECKOUT',
    'ENTER_DELIVERY_ADDRESS',
    'VIEW_ORDERS',
];

async function main() {
    const prisma = new PrismaClient();
    try {
        const before = await prisma.tenant.findUnique({
            where: { id: KIM_ID },
            select: { id: true, name: true, businessType: true },
        });
        if (!before) {
            console.error(`Tenant ${KIM_ID} not found`);
            process.exit(1);
        }
        console.log(`Before: ${before.name} (${before.id}) → businessType=${before.businessType}`);

        await prisma.$transaction(async (tx) => {
            await tx.tenant.update({
                where: { id: KIM_ID },
                data: { businessType: 'SERVICE' },
            });

            // Reset conversations stranded in PRODUCT bot states. Prisma's
            // JsonFilter `path`+`equals` works on JsonB; we run one update per
            // candidate state because `in` isn't supported for path filters.
            let resetCount = 0;
            for (const state of PRODUCT_BOT_STATES) {
                const r = await tx.conversation.updateMany({
                    where: {
                        tenantId: KIM_ID,
                        botContext: { path: ['state'], equals: state },
                    },
                    data: { botContext: { state: 'WELCOME' } },
                });
                if (r.count > 0) {
                    console.log(`  reset ${r.count} conversation(s) from ${state} → WELCOME`);
                    resetCount += r.count;
                }
            }
            console.log(`Conversations reset: ${resetCount}`);
        });

        const after = await prisma.tenant.findUnique({
            where: { id: KIM_ID },
            select: { id: true, name: true, businessType: true },
        });
        console.log(`After:  ${after?.name} → businessType=${after?.businessType}`);

        const productTenants = await prisma.tenant.count({ where: { businessType: 'PRODUCT' } });
        console.log(`PRODUCT tenants remaining on the platform: ${productTenants}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
