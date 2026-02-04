import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

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

        const tenantId = request.user.tenantId;
        const date = new Date(query.date);
        const dayOfWeek = date.getDay();

        // Get duration from service if provided
        let duration = query.durationMinutes;
        if (query.serviceId) {
            const service = await fastify.prisma.service.findFirst({
                where: { id: query.serviceId, tenantId },
            });
            if (service) {
                duration = service.durationMinutes;
            }
        }

        // Check if it's a blackout date
        const isBlackout = await fastify.prisma.blackoutDate.findUnique({
            where: {
                tenantId_date: { tenantId, date },
            },
        });

        if (isBlackout) {
            return { data: [], isBlackout: true };
        }

        // Get working hours for this day
        const workingHours = await fastify.prisma.workingHours.findUnique({
            where: {
                tenantId_dayOfWeek: { tenantId, dayOfWeek },
            },
        });

        if (!workingHours || !workingHours.isActive) {
            return { data: [], notWorking: true };
        }

        // Generate all possible slots
        const slots = generateTimeSlots(
            date,
            workingHours.startTime,
            workingHours.endTime,
            duration
        );

        // Get existing bookings for this date
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const bookings = await fastify.prisma.booking.findMany({
            where: {
                tenantId,
                status: 'CONFIRMED',
                startTime: { gte: startOfDay },
                endTime: { lte: endOfDay },
            },
        });

        // Filter out booked slots
        const availableSlots = slots.filter((slot) => {
            const slotStart = slot.start.getTime();
            const slotEnd = slot.end.getTime();

            return !bookings.some((booking) => {
                const bookingStart = booking.startTime.getTime();
                const bookingEnd = booking.endTime.getTime();

                // Check for overlap
                return slotStart < bookingEnd && slotEnd > bookingStart;
            });
        });

        // Filter out past times
        const now = new Date();
        const futureSlots = availableSlots.filter(
            (slot) => slot.start.getTime() > now.getTime()
        );

        return {
            data: futureSlots.map((s) => ({
                start: s.start.toISOString(),
                end: s.end.toISOString(),
                startTime: formatTime(s.start),
                endTime: formatTime(s.end),
            })),
        };
    });
};

// Helper functions
function generateTimeSlots(
    date: Date,
    startTime: string,
    endTime: string,
    durationMinutes: number
): Array<{ start: Date; end: Date }> {
    const slots: Array<{ start: Date; end: Date }> = [];

    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const start = new Date(date);
    start.setHours(startHour, startMinute, 0, 0);

    const end = new Date(date);
    end.setHours(endHour, endMinute, 0, 0);

    let current = new Date(start);

    while (current.getTime() + durationMinutes * 60000 <= end.getTime()) {
        const slotEnd = new Date(current.getTime() + durationMinutes * 60000);
        slots.push({
            start: new Date(current),
            end: slotEnd,
        });

        // Advance by 30 minutes for slot starts
        current = new Date(current.getTime() + 30 * 60000);
    }

    return slots;
}

function formatTime(date: Date): string {
    return date.toTimeString().slice(0, 5);
}

export default availabilityRoutes;
