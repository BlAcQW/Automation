import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { TemplatePurpose } from '@prisma/client';
import { syncBookingToCalendar, deleteCalendarEvent } from '../../services/calendar.js';
import { scheduleNotification, scheduleReminder, cancelReminder } from '../../services/notification.js';

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
            status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
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

        // Calculate end time
        const startTime = body.startTime;
        const endTime = new Date(startTime.getTime() + service.durationMinutes * 60000);

        // Check for conflicts (using serializable transaction)
        const booking = await fastify.prisma.$transaction(async (tx) => {
            // Lock and check for overlapping bookings
            const conflicting = await tx.booking.findFirst({
                where: {
                    tenantId,
                    status: 'CONFIRMED',
                    OR: [
                        {
                            startTime: { lt: endTime },
                            endTime: { gt: startTime },
                        },
                    ],
                },
            });

            if (conflicting) {
                throw new Error('Time slot is no longer available');
            }

            // Generate unique booking reference
            const bookingReference = `BK-${nanoid(8).toUpperCase()}`;

            // Create booking
            return tx.booking.create({
                data: {
                    tenantId,
                    serviceId: body.serviceId,
                    customerName: body.customerName,
                    customerPhone: body.customerPhone,
                    startTime,
                    endTime,
                    bookingReference,
                    notes: body.notes,
                },
                include: { service: true },
            });
        }, {
            isolationLevel: 'Serializable',
        });

        // Queue WhatsApp template-driven confirmation + reminder. All proactive
        // sends go through approved templates so they pass the Meta 24-hour
        // window check.
        const bookingTime = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await scheduleNotification({
            queue: fastify.queues.notifications,
            purpose: TemplatePurpose.BOOKING_CONFIRMATION,
            tenantId,
            customerPhone: booking.customerPhone,
            variables: [
                booking.customerName,
                service.name,
                startTime.toLocaleDateString(),
                bookingTime,
                booking.bookingReference,
            ],
            jobId: `booking_confirmation_${booking.id}`,
        });

        // Reminder 1 hour before the appointment.
        const reminderTime = new Date(startTime.getTime() - 60 * 60 * 1000);
        await scheduleReminder({
            queue: fastify.queues.reminders,
            tenantId,
            bookingId: booking.id,
            customerPhone: booking.customerPhone,
            variables: [service.name, bookingTime],
            sendAt: reminderTime,
        });

        // Sync to Google Calendar (if connected)
        await syncBookingToCalendar({
            bookingId: booking.id,
            tenantId,
            prisma: fastify.prisma,
        });

        // Create in-app notification
        await fastify.prisma.notification.create({
            data: {
                tenantId,
                type: 'NEW_BOOKING',
                title: 'New Booking',
                message: `${body.customerName} booked ${service.name} for ${body.startTime.toLocaleDateString()}`,
                metadata: { bookingId: booking.id, bookingReference: booking.bookingReference },
            },
        });

        return booking;
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

        const existing = await fastify.prisma.booking.findFirst({
            where: { id, tenantId: request.user.tenantId },
            include: { service: true },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Booking not found');
        }

        if (existing.status !== 'CONFIRMED') {
            throw fastify.httpErrors.badRequest('Booking cannot be cancelled');
        }

        const booking = await fastify.prisma.booking.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });

        // Send cancellation template + drop any pending reminder.
        await scheduleNotification({
            queue: fastify.queues.notifications,
            purpose: TemplatePurpose.BOOKING_CANCELLED,
            tenantId: request.user.tenantId,
            customerPhone: booking.customerPhone,
            variables: [
                existing.service.name,
                existing.startTime.toLocaleDateString(),
            ],
            jobId: `booking_cancelled_${booking.id}`,
        });
        await cancelReminder(fastify.queues.reminders, booking.id);

        // Create in-app notification
        await fastify.prisma.notification.create({
            data: {
                tenantId: request.user.tenantId,
                type: 'BOOKING_CANCELLED',
                title: 'Booking Cancelled',
                message: `Booking ${existing.bookingReference || booking.id} has been cancelled`,
                metadata: { bookingId: booking.id },
            },
        });

        return booking;
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
