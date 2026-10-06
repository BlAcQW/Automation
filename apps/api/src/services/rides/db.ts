/**
 * The Prisma handle the rides services take: the real (tenant-guarded)
 * extended client, or a transaction client opened from it. Typed, so a wrong
 * column name fails `tsc` instead of failing at runtime.
 */
import type { ExtendedPrismaClient } from '../../plugins/prisma.js';

export type RidesTx = Omit<ExtendedPrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
export type RidesDb = RidesTx;
export type RidesClient = ExtendedPrismaClient;

/** Postgres unique violation, as Prisma reports it. */
export function isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string } | null)?.code === 'P2002';
}
