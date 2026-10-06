/**
 * Install TURBO's RIDES pack on ONE tenant: default ride settings (if none),
 * the "turbo-founding" flow published as that tenant's own version (only when
 * it changed), and the tenant switched to it (conversationMode 'flow').
 *
 *   DATABASE_URL=... npx tsx scripts/seed-turbo.ts --tenant <tenantId> --yes
 *
 * It uses exactly the DATABASE_URL in the environment and does not load any
 * .env file: you choose the database, deliberately. Without --yes it only
 * prints what it would do. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import { registerRidesPack } from '../src/services/rides/index.js';
import { installTurboPack } from '../src/services/rides/install.js';
import { registerFlowPaymentFulfiller } from '../src/services/flow-payments.js';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    const tenantId = arg('tenant');
    const confirmed = process.argv.includes('--yes');
    if (!tenantId) {
        console.error('Usage: npx tsx scripts/seed-turbo.ts --tenant <tenantId> --yes');
        process.exit(2);
    }
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set. Export it for the database you mean to change.');
        process.exit(2);
    }
    const host = (() => { try { return new URL(process.env.DATABASE_URL!).host; } catch { return '(unparseable)'; } })();
    if (!confirmed) {
        console.log(`Would install the TURBO rides pack on tenant ${tenantId} in database at ${host}. Re-run with --yes to do it.`);
        return;
    }

    const prisma = new PrismaClient();
    try {
        // The flow is validated against the registered actions and payment kinds.
        registerFlowPaymentFulfiller();
        registerRidesPack(prisma as never);
        const result = await installTurboPack(prisma, { tenantId, createdBy: 'seed-turbo' });
        console.log(JSON.stringify({ tenantId, database: host, ...result }, null, 2));
        if (result.vertical !== 'RIDES') {
            console.warn(`Note: tenant vertical is ${result.vertical}, not RIDES. The flow is active via conversationMode=flow; set the vertical deliberately if billing/plans depend on it.`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
