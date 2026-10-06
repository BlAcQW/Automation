/**
 * Backfill Customer records for history that predates customer linking.
 *
 * For every tenant, finds conversations, bookings and orders with no
 * customerId, creates a Customer for each distinct phone it can normalise, and
 * links the rows to it. Run with:
 *
 *   npx tsx scripts/backfill-customers.ts --dry-run          # counts only, writes nothing
 *   npx tsx scripts/backfill-customers.ts                    # do it
 *   npx tsx scripts/backfill-customers.ts --tenant=<id> --batch=200
 *
 * Safe to re-run: only rows with customerId = null are read, customers are
 * found-or-created by (tenant, phone), and a known name or email is never
 * overwritten. Rows whose phone cannot be normalised (garbage, no phone, a
 * local "0..." number for a tenant with no business number to say which
 * country) are left exactly as they are and counted in the report.
 *
 * Backfilled customers do not publish `customer.created`: they are not new,
 * and a webhook storm for a tenant's whole history helps nobody.
 */

import { upsertCustomerByPhone } from '../src/services/customers.js';
import { normalizeCustomerPhone } from '../src/services/customer-phone.js';

type Source = 'conversation' | 'booking' | 'order';
const SOURCES: Source[] = ['conversation', 'booking', 'order'];
const DEFAULT_BATCH = 200;

export interface BackfillOptions {
    dryRun?: boolean;
    /** Rows read (and phones resolved) per round trip. */
    batchSize?: number;
    /** Restrict to one tenant. */
    tenantId?: string;
    log?: (line: string) => void;
}

export interface BackfillReport {
    dryRun: boolean;
    tenants: number;
    /** Customers created (or, in a dry run, that would be). */
    customersCreated: number;
    /** Rows linked (or that would be) per source. */
    linked: Record<Source, number>;
    /** Rows left alone because their phone cannot be normalised. */
    skipped: Record<Source, number>;
}

const zero = (): Record<Source, number> => ({ conversation: 0, booking: 0, order: 0 });

interface Row {
    id: string;
    customerPhone: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
}

const SELECT: Record<Source, Record<string, true>> = {
    conversation: { id: true, customerPhone: true, customerName: true },
    booking: { id: true, customerPhone: true, customerName: true, customerEmail: true },
    order: { id: true, customerPhone: true, customerName: true },
};

export async function backfillCustomers(prisma: any, options: BackfillOptions = {}): Promise<BackfillReport> {
    const dryRun = options.dryRun ?? false;
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH);
    const log = options.log ?? ((line: string) => console.log(line));

    const report: BackfillReport = { dryRun, tenants: 0, customersCreated: 0, linked: zero(), skipped: zero() };

    let tenantCursor: string | undefined;
    for (;;) {
        const tenants: Array<{ id: string; whatsappDisplayNumber: string | null }> = await prisma.tenant.findMany({
            where: options.tenantId ? { id: options.tenantId } : tenantCursor ? { id: { gt: tenantCursor } } : {},
            orderBy: { id: 'asc' },
            take: options.tenantId ? 1 : batchSize,
            select: { id: true, whatsappDisplayNumber: true },
        });
        if (tenants.length === 0) break;

        for (const tenant of tenants) {
            report.tenants += 1;
            const tenantReport = await backfillTenant(prisma, tenant, { dryRun, batchSize });
            report.customersCreated += tenantReport.customersCreated;
            for (const s of SOURCES) {
                report.linked[s] += tenantReport.linked[s];
                report.skipped[s] += tenantReport.skipped[s];
            }
            log(
                `[backfill-customers] tenant=${tenant.id} created=${tenantReport.customersCreated} ` +
                    SOURCES.map((s) => `${s}:linked=${tenantReport.linked[s]},skipped=${tenantReport.skipped[s]}`).join(' '),
            );
        }
        if (options.tenantId) break;
        tenantCursor = tenants[tenants.length - 1].id;
    }

    log(
        `[backfill-customers] ${dryRun ? 'DRY RUN ' : ''}done: tenants=${report.tenants} ` +
            `customers${dryRun ? ' that would be' : ''} created=${report.customersCreated} ` +
            SOURCES.map((s) => `${s}:linked=${report.linked[s]},skipped=${report.skipped[s]}`).join(' '),
    );
    return report;
}

async function backfillTenant(
    prisma: any,
    tenant: { id: string; whatsappDisplayNumber: string | null },
    opts: { dryRun: boolean; batchSize: number },
): Promise<Omit<BackfillReport, 'dryRun' | 'tenants'>> {
    const out = { customersCreated: 0, linked: zero(), skipped: zero() };
    const businessNumber = tenant.whatsappDisplayNumber ?? null;
    // Phones already counted as created in a dry run (nothing is written, so
    // the database cannot tell us).
    const wouldCreate = new Set<string>();

    for (const source of SOURCES) {
        let cursor: string | undefined;
        for (;;) {
            const rows: Row[] = await prisma[source].findMany({
                where: { tenantId: tenant.id, customerId: null, ...(cursor ? { id: { gt: cursor } } : {}) },
                orderBy: { id: 'asc' },
                take: opts.batchSize,
                select: SELECT[source],
            });
            if (rows.length === 0) break;
            cursor = rows[rows.length - 1].id;

            // Group the batch by normalised phone: one customer lookup per number.
            const groups = new Map<string, Row[]>();
            for (const row of rows) {
                const phone = row.customerPhone ? normalizeCustomerPhone(row.customerPhone, businessNumber) : null;
                if (!phone) {
                    out.skipped[source] += 1;
                    continue;
                }
                groups.set(phone, [...(groups.get(phone) ?? []), row]);
            }

            for (const [phone, group] of groups) {
                const name = group.map((r) => r.customerName).find((n) => !!n?.trim());
                const email = group.map((r) => r.customerEmail).find((e) => !!e?.trim());

                if (opts.dryRun) {
                    const key = phone;
                    if (!wouldCreate.has(key)) {
                        const existing = await prisma.customer.findUnique({
                            where: { tenantId_phone: { tenantId: tenant.id, phone } },
                            select: { id: true },
                        });
                        if (!existing) out.customersCreated += 1;
                        wouldCreate.add(key);
                    }
                    out.linked[source] += group.length;
                    continue;
                }

                const customer = await upsertCustomerByPhone(
                    prisma,
                    { tenantId: tenant.id, phone, name, email, businessNumber },
                    {
                        publish: async () => {
                            out.customersCreated += 1;
                            return undefined;
                        },
                    },
                );
                if (!customer) {
                    out.skipped[source] += group.length;
                    continue;
                }
                const { count } = await prisma[source].updateMany({
                    where: { tenantId: tenant.id, customerId: null, id: { in: group.map((r) => r.id) } },
                    data: { customerId: customer.id },
                });
                out.linked[source] += count;
            }
            if (rows.length < opts.batchSize) break;
        }
    }
    return out;
}

function parseArgs(argv: string[]): BackfillOptions {
    const opts: BackfillOptions = {};
    for (const arg of argv) {
        if (arg === '--dry-run') opts.dryRun = true;
        else if (arg.startsWith('--tenant=')) opts.tenantId = arg.slice('--tenant='.length);
        else if (arg.startsWith('--batch=')) {
            const n = Number(arg.slice('--batch='.length));
            if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid --batch value: ${arg}`);
            opts.batchSize = n;
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    return opts;
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    const path = await import('node:path');
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.resolve(process.cwd(), '..', '..', '.env') });
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
        await backfillCustomers(prisma, opts);
    } finally {
        await prisma.$disconnect();
    }
}

// Only when run directly, never on import (the tests import the function).
if (process.argv[1] && /backfill-customers\.(ts|js)$/.test(process.argv[1]) && !process.env.VITEST) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
