import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export interface AvailableSlot {
    start: Date;
    end: Date;
    startTime: string; // "HH:MM"
    endTime: string;
}

export interface SlotComputationInput {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    date: Date;
    durationMinutes: number;
    /** Optional service for tenant-scoped duration override + future per-service rules. */
    serviceId?: string;
    /** Slot starts step every `stepMinutes`. Defaults to 30. */
    stepMinutes?: number;
    /**
     * How many bookings may overlap. Defaults to the tenant's
     * `bookingCapacity` (chairs, rooms, bays) when not supplied.
     */
    capacity?: number;
}

/** A booked interval. Only the endpoints matter for capacity maths. */
export interface BookedInterval {
    startTime: Date;
    endTime: Date;
}

/**
 * The largest number of bookings running at the same moment at any point
 * inside `window`.
 *
 * A plain count of overlapping bookings is wrong here, and wrong in the
 * direction that costs the business money: two bookings that each touch a long
 * candidate slot but never each other only ever occupy ONE chair, yet a count
 * would report two and refuse the booking. So sweep the start/end events and
 * track the running peak instead.
 *
 * Touching intervals do not overlap — a booking that ends exactly when the
 * next starts frees the chair.
 */
export function maxConcurrentDuring(
    window: BookedInterval,
    bookings: readonly BookedInterval[],
): number {
    const windowStart = window.startTime.getTime();
    const windowEnd = window.endTime.getTime();

    // +1 when a booking starts, -1 when it ends, clipped to the window.
    const events: Array<{ at: number; delta: number }> = [];
    for (const b of bookings) {
        const start = Math.max(b.startTime.getTime(), windowStart);
        const end = Math.min(b.endTime.getTime(), windowEnd);
        if (start >= end) continue; // no real overlap (includes touching)
        events.push({ at: start, delta: 1 });
        events.push({ at: end, delta: -1 });
    }

    // Ends before starts at the same instant, so back-to-back bookings do not
    // momentarily read as two.
    events.sort((a, b) => (a.at - b.at) || (a.delta - b.delta));

    let running = 0;
    let peak = 0;
    for (const e of events) {
        running += e.delta;
        if (running > peak) peak = running;
    }
    return peak;
}

export interface SlotComputationResult {
    slots: AvailableSlot[];
    isBlackout?: boolean;
    notWorking?: boolean;
}

/**
 * Shared slot-availability computation used by both the REST endpoint
 * (/availability/slots) and the WhatsApp bot.
 *
 * Reads:
 *   - WorkingHours for the target day-of-week,
 *   - BlackoutDate exclusions,
 *   - Existing CONFIRMED Booking overlaps on the date.
 *
 * Calendar busy times are NOT included here; they are queried directly from
 * Google Calendar in the REST `/calendar/busy` endpoint. Wiring them into
 * slot computation requires an authenticated calendar client and is deferred
 * to Phase 2.
 */
export async function computeAvailableSlots(input: SlotComputationInput): Promise<SlotComputationResult> {
    const { prisma, tenantId, date, stepMinutes = 30 } = input;
    let { durationMinutes } = input;

    // Chairs/rooms/bays. Falls back to 1 so a missing tenant behaves exactly
    // as the engine did before capacity existed.
    let capacity = input.capacity;
    if (capacity === undefined) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { bookingCapacity: true },
        });
        capacity = tenant?.bookingCapacity ?? 1;
    }
    if (!Number.isFinite(capacity) || capacity < 1) capacity = 1;

    if (input.serviceId) {
        const service = await prisma.service.findFirst({
            where: { id: input.serviceId, tenantId, isActive: true },
        });
        if (service) {
            durationMinutes = service.durationMinutes;
        }
    }

    // Normalise the date to midnight in server-local time. Tenant-timezone
    // correctness is a Phase 2 item (see audit).
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const blackout = await prisma.blackoutDate.findUnique({
        where: { tenantId_date: { tenantId, date: dayStart } },
    });
    if (blackout) {
        return { slots: [], isBlackout: true };
    }

    const dayOfWeek = dayStart.getDay();
    const workingHours = await prisma.workingHours.findUnique({
        where: { tenantId_dayOfWeek: { tenantId, dayOfWeek } },
    });

    if (!workingHours || !workingHours.isActive) {
        return { slots: [], notWorking: true };
    }

    const candidateSlots = generateTimeSlots(
        dayStart,
        workingHours.startTime,
        workingHours.endTime,
        durationMinutes,
        stepMinutes,
    );

    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    // PENDING_PAYMENT bookings count as held — two customers must not be
    // offered the same slot while one is mid-checkout. CANCELLED / COMPLETED /
    // NO_SHOW free the slot up.
    const bookings = await prisma.booking.findMany({
        where: {
            tenantId,
            status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
            startTime: { gte: dayStart, lte: dayEnd },
        },
        select: { startTime: true, endTime: true },
    });

    const now = Date.now();
    const available = candidateSlots.filter((slot) => {
        if (slot.start.getTime() <= now) {
            return false;
        }
        // Free while the busiest moment in the slot still leaves a chair.
        return maxConcurrentDuring(
            { startTime: slot.start, endTime: slot.end },
            bookings,
        ) < capacity;
    });

    return {
        slots: available.map((s) => ({
            start: s.start,
            end: s.end,
            startTime: formatTime(s.start),
            endTime: formatTime(s.end),
        })),
    };
}

function generateTimeSlots(
    date: Date,
    startTime: string,
    endTime: string,
    durationMinutes: number,
    stepMinutes: number,
): Array<{ start: Date; end: Date }> {
    const slots: Array<{ start: Date; end: Date }> = [];

    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const start = new Date(date);
    start.setHours(startHour, startMinute, 0, 0);

    const end = new Date(date);
    end.setHours(endHour, endMinute, 0, 0);

    const durationMs = durationMinutes * 60_000;
    const stepMs = stepMinutes * 60_000;
    let current = start.getTime();
    const endMs = end.getTime();

    while (current + durationMs <= endMs) {
        slots.push({
            start: new Date(current),
            end: new Date(current + durationMs),
        });
        current += stepMs;
    }

    return slots;
}

function formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}
