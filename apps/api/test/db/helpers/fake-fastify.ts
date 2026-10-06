import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';
import { guardedPrisma } from './db.js';

export const silentLogger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child() { return silentLogger; },
    level: 'silent',
} as any;

/**
 * The slice of a Fastify instance the services under test touch: the REAL
 * guarded prisma, a silent logger and stubbed BullMQ queues (Redis is not part
 * of this suite).
 */
export async function makeFastify(): Promise<FastifyInstance & { queues: any }> {
    const prisma = await guardedPrisma();
    const queue = () => ({ add: vi.fn().mockResolvedValue({ id: 'job' }) });
    return { prisma, log: silentLogger, queues: { notifications: queue(), reminders: queue() } } as any;
}
