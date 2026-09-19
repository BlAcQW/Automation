import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TemplatePurpose } from '@prisma/client';
import { scheduleNotification, cancelReminder } from '../../services/notification.js';
import { cancelBooking } from '../../services/booking-cancel.js';
import { afterBookingConfirmed, createBookingAtomic, SlotTakenError } from '../../services/booking-create.js';

// Validation schemas
const createBookingSchema = z.object({
    serviceId: z.string(),
    customerName: z.string().min(2),
    customerPhone: z.string().min(10),
    startTime: z.string().transform((s) => new Date(s)),
    notes: z.string().optional(),
});

const updateBookingSchema = z.object({
    status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
    notes: z.string().optional(),
});

const bookingsRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /bookings - List bookings
    fastify.get('/', async (request) => {
        const query = z.object({
            from: z.string().optional(),
            to: z.string().optional(),
            status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
        }).parse(request.query);

        const where: any = { tenantId: request.user.tenantId };

        if (query.status) where.status = query.status;
        if (query.from) where.startTime = { ...where.startTime, gte: new Date(query.from) };
        if (query.to) where.startTime = { ...where.startTime, lte: new Date(query.to) };

        const skip = (query.page - 1) * query.limit;

        const [bookings, total] = await Promise.all([
            fastify.prisma.booking.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { startTime: 'asc' },
                include: {
                    service: {
                        select: { id: true, name: true, price: true, durationMinutes: true },
                    },
                },
            }),
            fastify.prisma.booking.count({ where }),
        ]);

        return {
            data: bookings,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /bookings/upcoming - Get upcoming bookings for today
    fastify.get('/upcoming', async (request) => {
        const now = new Date();
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const bookings = await fastify.prisma.booking.findMany({
            where: {
                tenantId: request.user.tenantId,
                status: 'CONFIRMED',
                startTime: { gte: now, lte: endOfDay },
            },
            orderBy: { startTime: 'asc' },
            include: {
                service: { select: { name: true } },
            },
        });

        return { data: bookings };
    });

    // GET /bookings/:id - Get single booking
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const booking = await fastify.prisma.booking.findFirst({
            where: { id, tenantId: request.user.tenantId },
            include: {
                service: true,
            },
        });

        if (!booking) {
            throw fastify.httpErrors.notFound('Booking not found');
        }

        return booking;
    });

    // POST /bookings - Create new booking
    fastify.post('/', async (request) => {
        const body = createBookingSchema.parse(request.body);
        const tenantId = request.user.tenantId;

        // Get service
        const service = await fastify.prisma.service.findFirst({
            where: { id: body.serviceId, tenantId, isActive: true },
        });

        if (!service) {
            throw fastify.httpErrors.badRequest('Service not found or inactive');
        }

        const startTime = body.startTime;
        if (Number.isNaN(startTime.getTime())) {
            throw fastify.httpErrors.badRequest('Invalid start time');
        }
        const endTime = new Date(startTime.getTime() + service.durationMinutes * 60000);

        // A booking made by staff from the dashboard is a walk-in or a phone
        // booking: it is confirmed straight away, no deposit hold. The shared
        // creator still re-checks the slot against held and confirmed bookings.
        let created;
        try {
            created = await createBookingAtomic({
                prisma: fastify.prisma,
                tenantId,
                serviceId: body.serviceId,
                customerName: body.customerName,
                customerPhone: body.customerPhone,
                startTime,
                endTime,
                depositAmount: 0,
                notes: body.notes,
            });
        } catch (err) {
            if (err instanceof SlotTakenError) {
                throw fastify.httpErrors.conflict('That time is no longer available');
            }
            throw err;
        }

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { timezone: true },
        });

        await afterBookingConfirmed({
            prisma: fastify.prisma,
            queues: fastify.queues,
            log: fastify.log,
            tenantId,
            timezone: tenant?.timezone,
            booking: created,
            service,
        });

        return fastify.prisma.booking.findUnique({
            where: { id: created.id },
            include: { service: true },
        });
    });

    // PATCH /bookings/:id - Update booking
    fastify.patch('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const body = updateBookingSchema.parse(request.body);

        const existing = await fastify.prisma.booking.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Booking not found');
        }

        const booking = await fastify.prisma.booking.update({
            where: { id },
            data: body,
            include: { service: true },
        });

        // If cancelled, send cancellation template + drop any pending reminder.
        if (body.status === 'CANCELLED') {
            await scheduleNotification({
                queue: fastify.queues.notifications,
                purpose: TemplatePurpose.BOOKING_CANCELLED,
                tenantId: request.user.tenantId,
                customerPhone: booking.customerPhone,
                variables: [
                    booking.service.name,
                    booking.startTime.toLocaleDateString(),
                ],
                jobId: `booking_cancelled_${booking.id}`,
            });
            await cancelReminder(fastify.queues.reminders, booking.id);
        }

        return booking;
    });

    // POST /bookings/:id/cancel - Cancel booking
    fastify.post('/:id/cancel', async (request) => {
        const { id } = request.params as { id: string };

        // Tenant-scope guard before handing off to the shared cancel routine.
        const existing = await fastify.prisma.booking.findFirst({
            where: { id, tenantId: request.user.tenantId },
            select: { id: true },
        });
        if (!existing) {
            throw fastify.httpErrors.notFound('Booking not found');
        }

        const result = await cancelBooking({
            prisma: fastify.prisma,
            bookingId: id,
            reason: 'dashboard',
            notificationsQueue: fastify.queues.notifications,
            remindersQueue: fastify.queues.reminders,
        });

        if (!result.ok) {
            throw fastify.httpErrors.badRequest(
                result.reason === 'already_cancelled'
                    ? 'Booking is already cancelled'
                    : 'Booking cannot be cancelled',
            );
        }

        return { success: true, bookingId: result.booking.id };
    });

    // GET /bookings/by-reference/:ref - Find by booking reference
    fastify.get('/by-reference/:ref', async (request) => {
        const { ref } = request.params as { ref: string };

        const booking = await fastify.prisma.booking.findFirst({
            where: {
                bookingReference: ref,
                tenantId: request.user.tenantId,
            },
            include: { service: true },
        });

        if (!booking) {
            throw fastify.httpErrors.notFound('Booking not found');
        }

        return booking;
    });

    // GET /bookings/customer/:phone - Get bookings by customer phone
    fastify.get('/customer/:phone', async (request) => {
        const { phone } = request.params as { phone: string };

        const bookings = await fastify.prisma.booking.findMany({
            where: {
                tenantId: request.user.tenantId,
                customerPhone: phone,
            },
            orderBy: { startTime: 'desc' },
            take: 10,
            include: {
                service: { select: { name: true } },
            },
        });

        return { data: bookings };
    });
};

export default bookingsRoutes;
