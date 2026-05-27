import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { computeAvailableSlots } from '../../services/availability.js';

// Validation schemas
const workingHoursSchema = z.object({
    dayOfWeek: z.number().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    isActive: z.boolean().default(true),
});

const blackoutDateSchema = z.object({
    date: z.string().transform((s) => new Date(s)),
    reason: z.string().optional(),
});

const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // ============================================
    // WORKING HOURS
    // ============================================

    // GET /availability/hours - Get working hours
    fastify.get('/hours', async (request) => {
        const workingHours = await fastify.prisma.workingHours.findMany({
            where: { tenantId: request.user.tenantId },
            orderBy: { dayOfWeek: 'asc' },
        });

        return { data: workingHours };
    });

    // PUT /availability/hours - Set all working hours at once
    fastify.put('/hours', async (request) => {
        const body = z.array(workingHoursSchema).parse(request.body);
        const tenantId = request.user.tenantId;

        // Delete existing and create new
        await fastify.prisma.$transaction(async (tx) => {
            await tx.workingHours.deleteMany({
                where: { tenantId },
            });

            await tx.workingHours.createMany({
                data: body.map((h) => ({
                    tenantId,
                    ...h,
                })),
            });
        });

        const workingHours = await fastify.prisma.workingHours.findMany({
            where: { tenantId },
            orderBy: { dayOfWeek: 'asc' },
        });

        return { data: workingHours };
    });

    // PATCH /availability/hours/:dayOfWeek - Update single day
    fastify.patch('/hours/:dayOfWeek', async (request) => {
        const { dayOfWeek } = request.params as { dayOfWeek: string };
        const day = parseInt(dayOfWeek, 10);
        const body = workingHoursSchema.partial().parse(request.body);
        const tenantId = request.user.tenantId;

        const existing = await fastify.prisma.workingHours.findUnique({
            where: {
                tenantId_dayOfWeek: { tenantId, dayOfWeek: day },
            },
        });

        if (existing) {
            return await fastify.prisma.workingHours.update({
                where: { id: existing.id },
                data: body,
            });
        } else {
            return await fastify.prisma.workingHours.create({
                data: {
                    tenantId,
                    dayOfWeek: day,
                    startTime: body.startTime || '09:00',
                    endTime: body.endTime || '17:00',
                    isActive: body.isActive ?? true,
                },
            });
        }
    });

    // ============================================
    // BLACKOUT DATES
    // ============================================

    // GET /availability/blackouts - Get blackout dates
    fastify.get('/blackouts', async (request) => {
        const query = z.object({
            from: z.string().optional(),
            to: z.string().optional(),
        }).parse(request.query);

        const where: any = { tenantId: request.user.tenantId };

        if (query.from) {
            where.date = { ...where.date, gte: new Date(query.from) };
        }
        if (query.to) {
            where.date = { ...where.date, lte: new Date(query.to) };
        }

        const blackouts = await fastify.prisma.blackoutDate.findMany({
            where,
            orderBy: { date: 'asc' },
        });

        return { data: blackouts };
    });

    // POST /availability/blackouts - Add blackout date
    fastify.post('/blackouts', async (request) => {
        const body = blackoutDateSchema.parse(request.body);
        const tenantId = request.user.tenantId;

        // Check if already exists
        const existing = await fastify.prisma.blackoutDate.findUnique({
            where: {
                tenantId_date: { tenantId, date: body.date },
            },
        });

        if (existing) {
            throw fastify.httpErrors.conflict('Blackout date already exists');
        }

        const blackout = await fastify.prisma.blackoutDate.create({
            data: {
                tenantId,
                date: body.date,
                reason: body.reason,
            },
        });

        return blackout;
    });

    // DELETE /availability/blackouts/:id - Remove blackout date
    fastify.delete('/blackouts/:id', async (request) => {
        const { id } = request.params as { id: string };

        const existing = await fastify.prisma.blackoutDate.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Blackout date not found');
        }

        await fastify.prisma.blackoutDate.delete({
            where: { id },
        });

        return { deleted: true };
    });

    // ============================================
    // AVAILABILITY SLOTS (for booking)
    // ============================================

    // GET /availability/slots - Get available time slots
    fastify.get('/slots', async (request) => {
        const query = z.object({
            date: z.string(),
            serviceId: z.string().optional(),
            durationMinutes: z.coerce.number().default(60),
        }).parse(request.query);

        const result = await computeAvailableSlots({
            prisma: fastify.prisma,
            tenantId: request.user.tenantId,
            date: new Date(query.date),
            durationMinutes: query.durationMinutes,
            serviceId: query.serviceId,
        });

        if (result.isBlackout) {
            return { data: [], isBlackout: true };
        }
        if (result.notWorking) {
            return { data: [], notWorking: true };
        }

        return {
            data: result.slots.map((s) => ({
                start: s.start.toISOString(),
                end: s.end.toISOString(),
                startTime: s.startTime,
                endTime: s.endTime,
            })),
        };
    });
};

export default availabilityRoutes;
