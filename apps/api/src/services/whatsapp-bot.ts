import { TemplatePurpose, type Prisma } from '@prisma/client';
import type { Queue as BullQueue } from 'bullmq';
import { decrypt } from './crypto.js';
import { computeAvailableSlots } from './availability.js';
import { updateCalendarEvent } from './calendar.js';
import { scheduleNotification, cancelReminder } from './notification.js';
import { cancelBooking } from './booking-cancel.js';
import { generatePublicToken } from '../lib/public-token.js';
import { initializeTransaction } from './paystack.js';
import { tryReserveOutbound, rollbackOutboundReservation } from './usage.js';

/**
 * Thrown by `sendMessage` when the outbound message couldn't be delivered.
 * `kind` tags the failure source so callers can decide whether to retry,
 * route to a human handoff, or surface a different state transition.
 */
export class BotSendError extends Error {
    constructor(public readonly kind: 'quota_exhausted' | 'meta_error' | 'network_error', message: string) {
        super(`bot_send_${kind}: ${message}`);
        this.name = 'BotSendError';
    }
}

/**
 * Thrown by `createBooking` when the chosen time-window already has another
 * CONFIRMED or PENDING_PAYMENT booking for the same tenant + service. The
 * ENTER_NAME state handler catches this and re-shows the date picker so the
 * customer can pick a fresh slot.
 */
export class BookingConflictError extends Error {
    constructor(public readonly conflictingId: string) {
        super(`booking_conflict: slot already taken by ${conflictingId}`);
        this.name = 'BookingConflictError';
    }
}
import { config } from '../config/index.js';

// Bot conversation states
export enum BotState {
    WELCOME = 'WELCOME',
    MAIN_MENU = 'MAIN_MENU',
    // Service business — booking
    SELECT_SERVICE = 'SELECT_SERVICE',
    SELECT_DATE = 'SELECT_DATE',
    SELECT_TIME = 'SELECT_TIME',
    CONFIRM_BOOKING = 'CONFIRM_BOOKING',
    ENTER_NAME = 'ENTER_NAME',
    ENTER_PHONE = 'ENTER_PHONE',
    VIEW_APPOINTMENTS = 'VIEW_APPOINTMENTS',
    // Service business — manage existing booking
    VIEW_APPOINTMENTS_DETAIL = 'VIEW_APPOINTMENTS_DETAIL',
    CONFIRM_CANCEL = 'CONFIRM_CANCEL',
    RESCHEDULE_DATE = 'RESCHEDULE_DATE',
    RESCHEDULE_TIME = 'RESCHEDULE_TIME',
    // Product business
    BROWSE_PRODUCTS = 'BROWSE_PRODUCTS',
    VIEW_PRODUCT = 'VIEW_PRODUCT',
    ADD_TO_CART = 'ADD_TO_CART',
    VIEW_CART = 'VIEW_CART',
    CHECKOUT = 'CHECKOUT',
    ENTER_DELIVERY_ADDRESS = 'ENTER_DELIVERY_ADDRESS',
    VIEW_ORDERS = 'VIEW_ORDERS',
    // Common
    CONTACT_SUPPORT = 'CONTACT_SUPPORT',
}

// Context stored in conversation
export interface BotContext {
    state: BotState;
    // Service booking
    serviceId?: string;
    serviceName?: string;
    selectedDate?: string;
    selectedTime?: string;
    // Manage existing booking (cancel / reschedule)
    activeBookingId?: string;
    // Customer info
    customerName?: string;
    customerPhone?: string;
    deliveryAddress?: string;
    // Product ordering
    cart?: Array<{ productId: string; productName: string; quantity: number; price: number }>;
    currentProductId?: string;
    // Meta
    lastMessageAt?: string;
}

interface SendMessagePayload {
    to: string;
    type: 'text' | 'interactive' | 'image';
    text?: { body: string };
    interactive?: any;
    image?: { link: string; caption?: string };
}

// Main bot engine class
export class WhatsAppBotEngine {
    private prisma: any;
    private tenantId: string;
    private accessToken: string;
    private phoneNumberId: string;
    private businessType: 'SERVICE' | 'PRODUCT';
    private tenantTimezone: string;
    private paystackSecretKeyEncrypted: string | null;
    private paymentCurrency: string;
    private notificationsQueue: BullQueue | null;
    private remindersQueue: BullQueue | null;

    constructor(
        prisma: any,
        tenant: any,
        queues?: { notifications?: BullQueue | null; reminders?: BullQueue | null },
    ) {
        this.prisma = prisma;
        this.tenantId = tenant.id;
        // Decrypt the stored access token
        this.accessToken = tenant.whatsappAccessToken ? decrypt(tenant.whatsappAccessToken) : '';
        this.phoneNumberId = tenant.whatsappPhoneNumberId;
        this.businessType = tenant.businessType || 'SERVICE';
        this.tenantTimezone = tenant.timezone || 'UTC';
        this.paystackSecretKeyEncrypted = tenant.paystackSecretKey ?? null;
        this.paymentCurrency = tenant.paymentCurrency || 'NGN';
        this.notificationsQueue = queues?.notifications ?? null;
        this.remindersQueue = queues?.reminders ?? null;
    }

    // Process incoming message and generate response
    async processMessage(conversationId: string, customerPhone: string, content: string): Promise<void> {
        // Read conversation with the lock-version we'll check on write.
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });
        const lockedVersion = (conversation as { contextVersion?: number } | null)?.contextVersion ?? 0;

        // Parse context. Prisma `Json?` already serializes/deserializes.
        const context: BotContext = (conversation.botContext as BotContext | null) ?? {
            state: BotState.WELCOME,
        };

        // Process based on state
        const response = await this.handleState(context, content, customerPhone);

        // If the bot routed the customer to CONTACT_SUPPORT, also flip the
        // conversation to HUMAN_ACTIVE so the next inbound message bypasses the
        // bot entirely. Reset the bot's internal state to WELCOME so that when
        // staff or the customer ("menu" keyword) hands control back, the bot
        // starts fresh instead of replaying the support trigger.
        const wentToSupport = context.state === BotState.CONTACT_SUPPORT;

        // Optimistic-lock write: only commit if no concurrent inbound has
        // bumped contextVersion since we read. If two messages from the same
        // customer arrive within ~ms, the loser's write is dropped here and
        // gets re-driven by BullMQ.
        const result = await this.prisma.conversation.updateMany({
            where: { id: conversationId, contextVersion: lockedVersion },
            data: {
                botContext: wentToSupport
                    ? ({ state: BotState.WELCOME } as unknown as Prisma.InputJsonValue)
                    : (context as unknown as Prisma.InputJsonValue),
                ...(wentToSupport && {
                    state: 'HUMAN_ACTIVE',
                    takeoverReason: 'customer_requested_support',
                }),
                contextVersion: { increment: 1 },
                updatedAt: new Date(),
            },
        });
        if (result.count === 0) {
            // Lost the race. Skip side effects so we don't double-message.
            // eslint-disable-next-line no-console
            console.warn(
                JSON.stringify({
                    msg: 'bot_context_version_conflict',
                    conversationId,
                    lockedVersion,
                }),
            );
            return;
        }

        // Send response(s). If any send throws (quota exhausted, Meta down,
        // network blip), stop the loop, increment botFailureCount, and let
        // the takeover-after-3-failures path route the customer to a human.
        // Outbound DB rows are only written for sends that actually succeeded.
        let sentAny = false;
        try {
            for (const msg of response.messages) {
                await this.sendMessage(customerPhone, msg);
                sentAny = true;

                // Store outbound message. Bot-authored messages are identified by
                // `direction === 'OUTBOUND'` — no separate isFromBot flag in schema.
                await this.prisma.message.create({
                    data: {
                        conversationId,
                        direction: 'OUTBOUND',
                        content: typeof msg.text?.body === 'string' ? msg.text.body : '[Interactive Message]',
                        messageType: msg.type.toUpperCase(),
                    },
                });
            }
            // All sends succeeded — clear the failure counter.
            await this.prisma.conversation.update({
                where: { id: conversationId },
                data: { botFailureCount: 0 },
            }).catch(() => undefined);
        } catch (err) {
            if (err instanceof BotSendError) {
                await this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: { botFailureCount: { increment: 1 } },
                }).catch(() => undefined);
                // eslint-disable-next-line no-console
                console.warn(
                    JSON.stringify({
                        msg: 'bot_send_failure',
                        conversationId,
                        kind: err.kind,
                        detail: err.message,
                        partialSends: sentAny,
                    }),
                );
                return;
            }
            throw err;
        }
    }

    // State machine handler
    private async handleState(context: BotContext, content: string, customerPhone: string): Promise<{ messages: SendMessagePayload[] }> {
        const messages: SendMessagePayload[] = [];

        switch (context.state) {
            case BotState.WELCOME:
                if (this.businessType === 'PRODUCT') {
                    messages.push(this.createTextMessage('👋 Welcome to our store! How can I help you today?'));
                    messages.push(this.createProductMainMenu());
                } else {
                    messages.push(this.createTextMessage('👋 Welcome to our booking service! How can I help you today?'));
                    messages.push(this.createMainMenu());
                }
                context.state = BotState.MAIN_MENU;
                break;

            case BotState.MAIN_MENU:
                if (this.businessType === 'PRODUCT') {
                    // Product business main menu
                    if (content === 'shop' || content.toLowerCase().includes('shop') || content.toLowerCase().includes('product')) {
                        const products = await this.getProducts();
                        if (products.length === 0) {
                            messages.push(this.createTextMessage('Sorry, no products are currently available. Please try again later.'));
                        } else {
                            messages.push(this.createProductList(products));
                            context.state = BotState.BROWSE_PRODUCTS;
                        }
                    } else if (content === 'orders' || content.toLowerCase().includes('order')) {
                        const orders = await this.getCustomerOrders(customerPhone);
                        if (orders.length === 0) {
                            messages.push(this.createTextMessage('You don\'t have any orders yet.'));
                        } else {
                            messages.push(this.createTextMessage(this.formatOrdersList(orders)));
                        }
                        messages.push(this.createProductMainMenu());
                    } else if (content === 'cart' || content.toLowerCase().includes('cart')) {
                        if (!context.cart || context.cart.length === 0) {
                            messages.push(this.createTextMessage('Your cart is empty. Start shopping!'));
                            messages.push(this.createProductMainMenu());
                        } else {
                            messages.push(this.createTextMessage(this.formatCart(context.cart)));
                            messages.push(this.createCartMenu());
                            context.state = BotState.VIEW_CART;
                        }
                    } else if (content === 'support' || content.toLowerCase().includes('help')) {
                        messages.push(this.createTextMessage('A team member will be with you shortly. Please describe your question or concern.'));
                        context.state = BotState.CONTACT_SUPPORT;
                    } else {
                        messages.push(this.createTextMessage('I didn\'t quite understand that. Please select an option:'));
                        messages.push(this.createProductMainMenu());
                    }
                } else {
                    // Service business main menu
                    if (content === 'book' || content.toLowerCase().includes('book')) {
                        const services = await this.prisma.service.findMany({
                            where: { tenantId: this.tenantId, isActive: true },
                            take: 10,
                        });
                        if (services.length === 0) {
                            messages.push(this.createTextMessage('Sorry, no services are currently available. Please try again later.'));
                        } else {
                            messages.push(this.createServiceList(services));
                            context.state = BotState.SELECT_SERVICE;
                        }
                    } else if (content === 'appointments' || content.toLowerCase().includes('appointment')) {
                        const bookings = await this.getCustomerBookings(customerPhone);
                        if (bookings.length === 0) {
                            messages.push(this.createTextMessage('You don\'t have any upcoming appointments.'));
                            messages.push(this.createMainMenu());
                        } else {
                            messages.push(this.createTextMessage(this.formatBookingsList(bookings)));
                            messages.push(this.createAppointmentsActionList(bookings));
                            context.state = BotState.VIEW_APPOINTMENTS_DETAIL;
                        }
                    } else if (content === 'support' || content.toLowerCase().includes('support') || content.toLowerCase().includes('help')) {
                        messages.push(this.createTextMessage('A team member will be with you shortly. Please describe your question or concern.'));
                        context.state = BotState.CONTACT_SUPPORT;
                    } else {
                        messages.push(this.createTextMessage('I didn\'t quite understand that. Please select an option:'));
                        messages.push(this.createMainMenu());
                    }
                }
                break;

            // ========================================
            // Service Business States
            // ========================================
            case BotState.SELECT_SERVICE:
                const service = await this.prisma.service.findFirst({
                    where: { tenantId: this.tenantId, id: content, isActive: true },
                });
                if (service) {
                    context.serviceId = service.id;
                    context.serviceName = service.name;
                    const depositSuffix = service.depositAmount
                        ? `, deposit ${this.paymentCurrency} ${Number(service.depositAmount).toFixed(2)}`
                        : '';
                    messages.push(this.createTextMessage(
                        `Great choice! ${service.name} (${service.durationMinutes} min, $${service.price}${depositSuffix})`,
                    ));
                    messages.push(await this.createDateList('Pick a date that works for you:'));
                    context.state = BotState.SELECT_DATE;
                } else {
                    messages.push(this.createTextMessage('Please select a valid service from the list.'));
                }
                break;

            case BotState.SELECT_DATE:
                const parsedDate = this.parseDate(content);
                if (parsedDate) {
                    context.selectedDate = parsedDate;
                    const times = await this.getAvailableTimes(parsedDate, context.serviceId!);
                    if (times.length === 0) {
                        messages.push(this.createTextMessage('Sorry, no available times on that date. Pick another:'));
                        messages.push(await this.createDateList('Pick another date:'));
                    } else {
                        messages.push(this.createTimeList(times));
                        context.state = BotState.SELECT_TIME;
                    }
                } else {
                    messages.push(this.createTextMessage('I couldn\'t parse that date. Pick from the list below:'));
                    messages.push(await this.createDateList('Pick a date:'));
                }
                break;

            case BotState.SELECT_TIME: {
                const validTimes = context.selectedDate && context.serviceId
                    ? await this.getAvailableTimes(context.selectedDate, context.serviceId)
                    : [];
                if (/^\d{2}:\d{2}$/.test(content) && validTimes.includes(content)) {
                    context.selectedTime = content;
                    messages.push(this.createTextMessage('Almost done! Please enter your name:'));
                    context.state = BotState.ENTER_NAME;
                } else if (validTimes.length === 0) {
                    messages.push(this.createTextMessage('Sorry, no times remain available for that date. Please pick another date:'));
                    context.state = BotState.SELECT_DATE;
                } else {
                    messages.push(this.createTextMessage('Please select a valid time from the options.'));
                    messages.push(this.createTimeList(validTimes));
                }
                break;
            }

            case BotState.ENTER_NAME:
                context.customerName = content.trim();
                context.customerPhone = customerPhone;
                try {
                    const { booking, service, requiresDeposit } = await this.createBooking(context);

                    if (requiresDeposit) {
                        const depositAmount = Number(service.depositAmount);
                        const payUrl = await this.tryInitPaystackPayment({
                            entity: 'booking',
                            id: booking.id,
                            amount: depositAmount,
                            customerPhone,
                        });

                        if (payUrl) {
                            messages.push(this.createTextMessage(
                                `🕐 Holding ${service.name} for you.\n\n` +
                                `📅 ${context.selectedDate} at ${context.selectedTime}\n` +
                                `👤 ${context.customerName}\n` +
                                `Reference: ${booking.bookingReference}\n` +
                                `💳 Deposit: ${this.paymentCurrency} ${depositAmount.toFixed(2)}\n\n` +
                                `🔗 Pay here to confirm:\n${payUrl}`,
                            ));
                        } else {
                            messages.push(this.createTextMessage(
                                `Booking placed on hold under reference ${booking.bookingReference}. ` +
                                `We hit a hiccup generating the payment link — our team will send it shortly.`,
                            ));
                        }
                        // Confirmation template fires only on payment success.
                    } else {
                        messages.push(this.createTextMessage(
                            `✅ Booking Confirmed!\n\n` +
                            `📋 ${context.serviceName}\n` +
                            `📅 ${context.selectedDate}\n` +
                            `⏰ ${context.selectedTime}\n` +
                            `👤 ${context.customerName}\n\n` +
                            `Reference: ${booking.bookingReference}\n\n` +
                            `We'll send you a reminder before your appointment!\n\n` +
                            `_Type "menu" anytime to make changes._`,
                        ));

                        // Fire BOOKING_CONFIRMATION template for the no-deposit
                        // happy path — keeps parity with the REST endpoint.
                        await scheduleNotification({
                            queue: this.notificationsQueue,
                            purpose: TemplatePurpose.BOOKING_CONFIRMATION,
                            tenantId: this.tenantId,
                            customerPhone,
                            variables: [
                                context.customerName ?? '',
                                service.name,
                                context.selectedDate ?? '',
                                context.selectedTime ?? '',
                                booking.bookingReference,
                            ],
                            jobId: `booking_confirmation_${booking.id}`,
                        }).catch(() => undefined);
                    }
                } catch (err) {
                    if (err instanceof BookingConflictError) {
                        // Lost the race — another customer grabbed the slot
                        // between when we showed the time list and now. Re-show
                        // the date picker; keep the service selection intact.
                        messages.push(this.createTextMessage(
                            'Sorry — someone just grabbed that slot. Pick another date:',
                        ));
                        messages.push(await this.createDateList('Pick a date:'));
                        context.selectedTime = undefined;
                        context.customerName = undefined;
                        context.state = BotState.SELECT_DATE;
                        break;
                    }
                    messages.push(this.createTextMessage('Sorry, there was an error creating your booking. Please try again.'));
                    // Error case only: surface the main menu so the customer
                    // can retry without typing. On success (with or without
                    // deposit), the confirmation message stands on its own —
                    // we don't follow it with an "anything else?" widget.
                    messages.push(this.createMainMenu());
                }
                // State transitions to MAIN_MENU regardless so the NEXT
                // inbound message gets a clean welcome if the customer
                // continues the conversation.
                context.state = BotState.MAIN_MENU;
                break;

            // ========================================
            // Manage existing booking — cancel / reschedule
            // ========================================
            case BotState.VIEW_APPOINTMENTS_DETAIL: {
                // Customer picked a booking from the appointments list (the
                // row id is the bookingId itself) OR tapped a `cancel_<id>` /
                // `reschedule_<id>` action.
                const action = content.startsWith('cancel_')
                    ? { kind: 'cancel' as const, id: content.slice('cancel_'.length) }
                    : content.startsWith('reschedule_')
                    ? { kind: 'reschedule' as const, id: content.slice('reschedule_'.length) }
                    : content === 'back'
                    ? { kind: 'back' as const, id: '' }
                    : { kind: 'select' as const, id: content };

                if (action.kind === 'back') {
                    messages.push(this.createMainMenu());
                    context.state = BotState.MAIN_MENU;
                    break;
                }

                // Tenant-safe lookup: every reference includes both tenantId
                // AND customerPhone so a manipulated botContext cannot touch
                // another customer's booking.
                const booking = await this.prisma.booking.findFirst({
                    where: {
                        id: action.id,
                        tenantId: this.tenantId,
                        customerPhone,
                        status: 'CONFIRMED',
                    },
                    include: { service: true },
                });

                if (!booking) {
                    messages.push(this.createTextMessage('That appointment is no longer available.'));
                    messages.push(this.createMainMenu());
                    context.state = BotState.MAIN_MENU;
                    break;
                }

                context.activeBookingId = booking.id;
                context.serviceId = booking.serviceId;
                context.serviceName = booking.service.name;

                if (action.kind === 'cancel') {
                    messages.push(this.createTextMessage(
                        `Cancel this appointment?\n\n` +
                        `📋 ${booking.service.name}\n` +
                        `📅 ${booking.startTime.toLocaleDateString()} ${booking.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n` +
                        `Reference: ${booking.bookingReference}`,
                    ));
                    messages.push(this.createYesNoMenu('Confirm cancel?'));
                    context.state = BotState.CONFIRM_CANCEL;
                } else if (action.kind === 'reschedule') {
                    messages.push(this.createTextMessage(`Reschedule ${booking.service.name}.`));
                    messages.push(await this.createDateList('Pick a new date:'));
                    context.state = BotState.RESCHEDULE_DATE;
                } else {
                    // Plain row select — re-prompt with action buttons.
                    messages.push(this.createBookingActionMenu(booking));
                }
                break;
            }

            case BotState.CONFIRM_CANCEL: {
                const yes = ['yes', 'y', 'confirm'].includes(content.toLowerCase());
                if (!yes) {
                    messages.push(this.createTextMessage('Cancellation aborted.'));
                    messages.push(this.createMainMenu());
                    context.activeBookingId = undefined;
                    context.state = BotState.MAIN_MENU;
                    break;
                }
                if (!context.activeBookingId) {
                    messages.push(this.createTextMessage('Sorry, I lost track of which appointment to cancel.'));
                    messages.push(this.createMainMenu());
                    context.state = BotState.MAIN_MENU;
                    break;
                }

                // Guard: the booking must belong to this customer before we
                // hand off to the shared cancel routine.
                const cancelTarget = await this.prisma.booking.findFirst({
                    where: {
                        id: context.activeBookingId,
                        tenantId: this.tenantId,
                        customerPhone,
                    },
                    select: { id: true },
                });

                if (!cancelTarget) {
                    messages.push(this.createTextMessage('That appointment is no longer cancellable.'));
                    messages.push(this.createMainMenu());
                    context.activeBookingId = undefined;
                    context.state = BotState.MAIN_MENU;
                    break;
                }

                const cancelResult = await cancelBooking({
                    prisma: this.prisma,
                    bookingId: cancelTarget.id,
                    reason: 'customer_whatsapp',
                    notificationsQueue: this.notificationsQueue,
                    remindersQueue: this.remindersQueue,
                });

                if (cancelResult.ok) {
                    messages.push(this.createTextMessage(
                        `✅ Cancelled.\n\n` +
                        `📋 ${cancelResult.booking.serviceName}\n` +
                        `Reference: ${cancelResult.booking.bookingReference}`,
                    ));
                } else {
                    messages.push(this.createTextMessage('That appointment is no longer cancellable.'));
                }
                messages.push(this.createMainMenu());
                context.activeBookingId = undefined;
                context.state = BotState.MAIN_MENU;
                break;
            }

            case BotState.RESCHEDULE_DATE: {
                if (!context.activeBookingId || !context.serviceId) {
                    messages.push(this.createTextMessage('Sorry, I lost track of which appointment to reschedule.'));
                    messages.push(this.createMainMenu());
                    context.state = BotState.MAIN_MENU;
                    break;
                }
                const parsedDate = this.parseDate(content);
                if (!parsedDate) {
                    messages.push(this.createTextMessage('I couldn\'t parse that. Pick from the list:'));
                    messages.push(await this.createDateList('Pick a new date:'));
                    break;
                }
                const times = await this.getAvailableTimes(parsedDate, context.serviceId);
                if (times.length === 0) {
                    messages.push(this.createTextMessage('Sorry, no available times on that date. Pick another:'));
                    messages.push(await this.createDateList('Pick another date:'));
                    break;
                }
                context.selectedDate = parsedDate;
                messages.push(this.createTimeList(times));
                context.state = BotState.RESCHEDULE_TIME;
                break;
            }

            case BotState.RESCHEDULE_TIME: {
                if (!context.activeBookingId || !context.serviceId || !context.selectedDate) {
                    messages.push(this.createTextMessage('Sorry, I lost track of the reschedule details.'));
                    messages.push(this.createMainMenu());
                    context.state = BotState.MAIN_MENU;
                    break;
                }
                const validTimes = await this.getAvailableTimes(context.selectedDate, context.serviceId);
                if (!/^\d{2}:\d{2}$/.test(content) || !validTimes.includes(content)) {
                    if (validTimes.length === 0) {
                        messages.push(this.createTextMessage('No times remain available — pick a different date:'));
                        context.state = BotState.RESCHEDULE_DATE;
                    } else {
                        messages.push(this.createTextMessage('Please select a valid time from the options.'));
                        messages.push(this.createTimeList(validTimes));
                    }
                    break;
                }

                const booking = await this.prisma.booking.findFirst({
                    where: {
                        id: context.activeBookingId,
                        tenantId: this.tenantId,
                        customerPhone,
                        status: 'CONFIRMED',
                    },
                    include: { service: true },
                });
                if (!booking) {
                    messages.push(this.createTextMessage('That appointment is no longer available to reschedule.'));
                    messages.push(this.createMainMenu());
                    context.activeBookingId = undefined;
                    context.state = BotState.MAIN_MENU;
                    break;
                }

                const newStart = new Date(`${context.selectedDate}T${content}:00`);
                const newEnd = new Date(newStart.getTime() + booking.service.durationMinutes * 60_000);

                await this.prisma.booking.update({
                    where: { id: booking.id },
                    data: { startTime: newStart, endTime: newEnd },
                });

                // Best-effort: bump the linked Google Calendar event +
                // reschedule the reminder.
                if (booking.calendarEventId) {
                    await updateCalendarEvent(booking.id, this.tenantId, this.prisma).catch(() => {});
                }
                await cancelReminder(this.remindersQueue, booking.id).catch(() => {});

                await scheduleNotification({
                    queue: this.notificationsQueue,
                    purpose: TemplatePurpose.BOOKING_RESCHEDULED,
                    tenantId: this.tenantId,
                    customerPhone,
                    variables: [
                        booking.service.name,
                        newStart.toLocaleDateString(),
                        content,
                    ],
                    jobId: `booking_rescheduled_${booking.id}_${newStart.getTime()}`,
                }).catch(() => {});

                messages.push(this.createTextMessage(
                    `✅ Rescheduled.\n\n` +
                    `📋 ${booking.service.name}\n` +
                    `📅 ${context.selectedDate} at ${content}\n` +
                    `Reference: ${booking.bookingReference}`,
                ));
                messages.push(this.createMainMenu());
                context.activeBookingId = undefined;
                context.selectedDate = undefined;
                context.state = BotState.MAIN_MENU;
                break;
            }

            // ========================================
            // Product Business States
            // ========================================
            case BotState.BROWSE_PRODUCTS:
                if (content === 'cart' || content.toLowerCase().includes('cart')) {
                    if (!context.cart || context.cart.length === 0) {
                        messages.push(this.createTextMessage('Your cart is empty. Browse our products to add items!'));
                        const products = await this.getProducts();
                        messages.push(this.createProductList(products));
                    } else {
                        messages.push(this.createTextMessage(this.formatCart(context.cart)));
                        messages.push(this.createCartMenu());
                        context.state = BotState.VIEW_CART;
                    }
                } else if (content === 'checkout') {
                    this.pushCheckoutStart(context, messages);
                } else {
                    const product = await this.prisma.product.findFirst({
                        where: { tenantId: this.tenantId, id: content, isActive: true },
                    });
                    if (product) {
                        context.currentProductId = product.id;
                        const detail =
                            `📦 *${product.name}*\n\n` +
                            `${product.description || ''}\n\n` +
                            `💰 Price: $${product.price}\n` +
                            `📊 In Stock: ${product.stock > 0 ? 'Yes' : 'Out of Stock'}`;
                        // Send the photo (with the detail as caption) when the
                        // product has an image; fall back to plain text otherwise.
                        if (product.imageUrl) {
                            messages.push(this.createImageMessage(product.imageUrl, detail));
                        } else {
                            messages.push(this.createTextMessage(detail));
                        }
                        if (product.stock > 0) {
                            messages.push(this.createAddToCartMenu());
                            context.state = BotState.VIEW_PRODUCT;
                        } else {
                            messages.push(this.createTextMessage('Sorry, this item is currently out of stock.'));
                            const products = await this.getProducts();
                            messages.push(this.createProductList(products));
                        }
                    } else {
                        messages.push(this.createTextMessage('Please select a product from the list.'));
                    }
                }
                break;

            case BotState.VIEW_PRODUCT:
                if (content === 'add' || content.toLowerCase().includes('add')) {
                    const product = await this.prisma.product.findUnique({
                        where: { id: context.currentProductId },
                    });
                    if (product) {
                        if (!context.cart) context.cart = [];
                        const existing = context.cart.find(item => item.productId === product.id);
                        if (existing) {
                            existing.quantity += 1;
                        } else {
                            context.cart.push({
                                productId: product.id,
                                productName: product.name,
                                quantity: 1,
                                price: parseFloat(product.price.toString()),
                            });
                        }
                        messages.push(this.createTextMessage(`✅ Added ${product.name} to cart!`));
                        messages.push(this.createProductBrowseMenu());
                        context.state = BotState.BROWSE_PRODUCTS;
                    }
                } else if (content === 'back') {
                    const products = await this.getProducts();
                    messages.push(this.createProductList(products));
                    context.state = BotState.BROWSE_PRODUCTS;
                } else if (content === 'checkout') {
                    this.pushCheckoutStart(context, messages);
                } else {
                    messages.push(this.createAddToCartMenu());
                }
                break;

            case BotState.VIEW_CART:
                if (content === 'checkout') {
                    this.pushCheckoutStart(context, messages);
                } else if (content === 'clear') {
                    context.cart = [];
                    messages.push(this.createTextMessage('Cart cleared!'));
                    const products = await this.getProducts();
                    messages.push(this.createProductList(products));
                    context.state = BotState.BROWSE_PRODUCTS;
                } else if (content === 'continue') {
                    const products = await this.getProducts();
                    messages.push(this.createProductList(products));
                    context.state = BotState.BROWSE_PRODUCTS;
                } else {
                    messages.push(this.createCartMenu());
                }
                break;

            case BotState.CHECKOUT:
                context.customerName = content.trim();
                context.customerPhone = customerPhone;
                messages.push(this.createTextMessage('Please enter your delivery address:'));
                context.state = BotState.ENTER_DELIVERY_ADDRESS;
                break;

            case BotState.ENTER_DELIVERY_ADDRESS:
                context.deliveryAddress = content.trim();
                try {
                    const order = await this.createOrder(context);
                    const total = context.cart!.reduce((sum, item) => sum + item.price * item.quantity, 0);

                    // If the tenant has Paystack connected, initialise a
                    // transaction and send the customer a payment link. The
                    // order stays UNPAID until the webhook fires.
                    const paymentLink = await this.tryInitPaystackPayment({
                        entity: 'order',
                        id: order.id,
                        amount: total,
                        customerPhone,
                    });

                    // Tracking link the customer can open anytime to see status.
                    const trackLine = order.publicToken
                        ? `\n\n🔎 Track your order:\n${config.frontendUrl}/track/${order.publicToken}`
                        : '';

                    if (paymentLink) {
                        messages.push(this.createTextMessage(
                            `✅ Order placed!\n\n` +
                            `📦 Order #${order.orderRef}\n` +
                            `👤 ${context.customerName}\n` +
                            `📍 ${context.deliveryAddress}\n` +
                            `💰 Total: ${this.paymentCurrency} ${total.toFixed(2)}\n\n` +
                            `🔗 Pay here:\n${paymentLink}\n\n` +
                            `We'll confirm once payment is received.` +
                            trackLine,
                        ));
                    } else {
                        // No Paystack configured (or init failed) — fall back
                        // to the pay-on-delivery confirmation flow.
                        messages.push(this.createTextMessage(
                            `✅ Order Placed!\n\n` +
                            `📦 Order #${order.orderRef}\n` +
                            `👤 ${context.customerName}\n` +
                            `📍 ${context.deliveryAddress}\n` +
                            `💰 Total: $${total.toFixed(2)}\n\n` +
                            `We'll notify you when your order is on its way!` +
                            trackLine,
                        ));
                    }

                    context.cart = [];
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Order checkout failed during bot flow', err);
                    messages.push(this.createTextMessage('Sorry, there was an error placing your order. Please try again.'));
                }
                messages.push(this.createProductMainMenu());
                context.state = BotState.MAIN_MENU;
                break;

            case BotState.VIEW_ORDERS:
                const orders = await this.getCustomerOrders(customerPhone);
                if (orders.length === 0) {
                    messages.push(this.createTextMessage('You don\'t have any orders yet.'));
                } else {
                    messages.push(this.createTextMessage(this.formatOrdersList(orders)));
                }
                messages.push(this.createProductMainMenu());
                context.state = BotState.MAIN_MENU;
                break;

            case BotState.CONTACT_SUPPORT:
                // Unreachable on the next inbound message because the
                // processMessage post-handler flipped conversation.state to
                // HUMAN_ACTIVE. Kept here as a defensive no-op in case the
                // state lands here in a race or test stub.
                return { messages: [] };
        }

        return { messages };
    }

    // ========================================
    // Helper Methods - Messages
    // ========================================

    private createTextMessage(body: string): SendMessagePayload {
        return { to: '', type: 'text', text: { body } };
    }

    private createImageMessage(link: string, caption?: string): SendMessagePayload {
        return { to: '', type: 'image', image: { link, caption } };
    }

    private createMainMenu(): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: 'What would you like to do?' },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: 'book', title: '📅 Book' } },
                        { type: 'reply', reply: { id: 'appointments', title: '📋 My Appointments' } },
                        { type: 'reply', reply: { id: 'support', title: '💬 Support' } },
                    ],
                },
            },
        };
    }

    private createProductMainMenu(): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: 'What would you like to do?' },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: 'shop', title: '🛍️ Shop' } },
                        { type: 'reply', reply: { id: 'orders', title: '📦 My Orders' } },
                        { type: 'reply', reply: { id: 'support', title: '💬 Support' } },
                    ],
                },
            },
        };
    }

    private createServiceList(services: any[]): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: 'Please select a service:' },
                action: {
                    button: 'View Services',
                    sections: [{
                        title: 'Available Services',
                        rows: services.map(s => ({
                            id: s.id,
                            title: s.name.substring(0, 24),
                            description: `${s.durationMinutes} min - $${s.price}`,
                        })),
                    }],
                },
            },
        };
    }

    private createAppointmentsActionList(bookings: any[]): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: 'Pick an appointment to manage:' },
                action: {
                    button: 'Manage',
                    sections: [{
                        title: 'Your Appointments',
                        rows: bookings.slice(0, 10).map((b) => ({
                            id: b.id,
                            title: `${b.service.name}`.substring(0, 24),
                            description: `${new Date(b.startTime).toLocaleDateString()} ${new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                        })),
                    }],
                },
            },
        };
    }

    private createBookingActionMenu(booking: any): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: `What would you like to do with ${booking.service.name}?` },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: `reschedule_${booking.id}`, title: '🔁 Reschedule' } },
                        { type: 'reply', reply: { id: `cancel_${booking.id}`, title: '❌ Cancel' } },
                        { type: 'reply', reply: { id: 'back', title: '⬅️ Back' } },
                    ],
                },
            },
        };
    }

    private createYesNoMenu(prompt: string): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: prompt },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: 'yes', title: '✅ Yes' } },
                        { type: 'reply', reply: { id: 'no', title: '❌ No' } },
                    ],
                },
            },
        };
    }

    private createTimeList(times: string[]): SendMessagePayload {
        // WhatsApp interactive lists cap each section at 10 rows. Even with
        // duration-aligned slot stepping (see getAvailableTimes) we cap here
        // as a defensive safety net so this can never blow up the bot again.
        const capped = times.slice(0, 10);
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: 'Select an available time:' },
                action: {
                    button: 'View Times',
                    sections: [{
                        title: 'Available Times',
                        rows: capped.map((t) => ({
                            id: t,
                            title: t,
                        })),
                    }],
                },
            },
        };
    }

    /**
     * Build an interactive list of the next 10 working days. WhatsApp limits
     * a single section to 10 rows, so we trim to that cap. Days the tenant
     * isn't open (per WorkingHours) and blackout dates are skipped.
     *
     * Tapping a row sends the row's `id` (YYYY-MM-DD) back as the inbound
     * content — `parseDate` accepts that format, so the SELECT_DATE handler
     * needs no special branch for interactive vs. text input.
     */
    private async createDateList(headerText = 'Pick a date that works for you:'): Promise<SendMessagePayload> {
        interface WHRow { dayOfWeek: number; startTime: string; endTime: string }
        interface BlackoutRow { date: Date }
        const [workingHours, blackouts]: [WHRow[], BlackoutRow[]] = await Promise.all([
            this.prisma.workingHours.findMany({
                where: { tenantId: this.tenantId, isActive: true },
                select: { dayOfWeek: true, startTime: true, endTime: true },
            }),
            this.prisma.blackoutDate.findMany({
                where: { tenantId: this.tenantId },
                select: { date: true },
            }),
        ]);
        const openDays = new Set(workingHours.map((w: WHRow) => w.dayOfWeek));
        const blackoutKeys = new Set(
            blackouts.map((b: BlackoutRow) => b.date.toISOString().slice(0, 10)),
        );
        const hoursByDay = new Map<number, WHRow>(
            workingHours.map((w: WHRow) => [w.dayOfWeek, w] as const),
        );

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const rows: Array<{ id: string; title: string; description?: string }> = [];
        const today = new Date();
        for (let offset = 0; offset < 30 && rows.length < 10; offset++) {
            const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
            const dow = d.getDay();
            if (!openDays.has(dow)) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (blackoutKeys.has(key)) continue;
            const hours = hoursByDay.get(dow);
            const labelPrefix = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `${dayNames[dow]}, ${monthNames[d.getMonth()]} ${d.getDate()}`;
            rows.push({
                id: key,
                title: labelPrefix.slice(0, 24),
                description: hours ? `${hours.startTime} – ${hours.endTime}` : undefined,
            });
        }

        if (rows.length === 0) {
            // No working days in the next 30 — fall back to a text prompt.
            return this.createTextMessage(
                'No open dates in the next 30 days. Please set your working hours in /availability, or message us to book manually.',
            );
        }

        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: headerText },
                action: {
                    button: 'Pick a date',
                    sections: [{
                        title: 'Available dates',
                        rows,
                    }],
                },
            },
        };
    }

    private createProductList(products: any[]): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: '🛍️ Browse our products:' },
                action: {
                    button: 'View Products',
                    sections: [{
                        title: 'Available Products',
                        rows: products.map(p => ({
                            id: p.id,
                            title: p.name.substring(0, 24),
                            description: `$${p.price}${p.stock <= 0 ? ' (Out of stock)' : ''}`,
                        })),
                    }],
                },
            },
        };
    }

    private createAddToCartMenu(): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: 'Would you like to add this to your cart?' },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: 'add', title: '🛒 Add to Cart' } },
                        { type: 'reply', reply: { id: 'back', title: '⬅️ Back' } },
                    ],
                },
            },
        };
    }

    private createProductBrowseMenu(): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: 'What would you like to do next?' },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: 'continue', title: '🛍️ Keep Shopping' } },
                        { type: 'reply', reply: { id: 'cart', title: '🛒 View Cart' } },
                    ],
                },
            },
        };
    }

    private createCartMenu(): SendMessagePayload {
        return {
            to: '',
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: 'Cart options:' },
                action: {
                    buttons: [
                        { type: 'reply', reply: { id: 'checkout', title: '✅ Checkout' } },
                        { type: 'reply', reply: { id: 'continue', title: '🛍️ Continue' } },
                        { type: 'reply', reply: { id: 'clear', title: '🗑️ Clear Cart' } },
                    ],
                },
            },
        };
    }

    // ========================================
    // Helper Methods - Data
    // ========================================

    private parseDate(input: string): string | null {
        const lower = input.toLowerCase().trim();
        const today = new Date();

        if (lower === 'today') {
            return today.toISOString().split('T')[0];
        }
        if (lower === 'tomorrow') {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }

        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayIndex = days.indexOf(lower);
        if (dayIndex !== -1) {
            const result = new Date(today);
            while (result.getDay() !== dayIndex) {
                result.setDate(result.getDate() + 1);
            }
            return result.toISOString().split('T')[0];
        }

        // Try ISO format
        if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
            return input;
        }

        return null;
    }

    private async getAvailableTimes(date: string, serviceId: string): Promise<string[]> {
        // Pin the slot step to the service's duration so we don't offer
        // overlapping start times (a 60-min service picked at 9:30 makes
        // 9:00 unbookable anyway) AND so the slot list stays small enough
        // for WhatsApp's 10-row interactive-list cap.
        const svc = await this.prisma.service.findUnique({
            where: { id: serviceId },
            select: { durationMinutes: true },
        });
        const durationMinutes = svc?.durationMinutes ?? 60;

        const result = await computeAvailableSlots({
            prisma: this.prisma,
            tenantId: this.tenantId,
            date: new Date(date),
            durationMinutes,
            stepMinutes: durationMinutes,
            serviceId,
        });
        return result.slots.map((s) => s.startTime);
    }

    private async getCustomerBookings(phone: string): Promise<any[]> {
        return this.prisma.booking.findMany({
            where: {
                tenantId: this.tenantId,
                customerPhone: phone,
                status: 'CONFIRMED',
                startTime: { gte: new Date() },
            },
            include: { service: true },
            orderBy: { startTime: 'asc' },
            take: 5,
        });
    }

    private formatBookingsList(bookings: any[]): string {
        return '📋 Your Upcoming Appointments:\n\n' +
            bookings.map(b =>
                `• ${b.service.name}\n  ${new Date(b.startTime).toLocaleDateString()} at ${new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            ).join('\n\n');
    }

    /**
     * Create a booking row. If the service has a deposit configured, the
     * booking is held as `PENDING_PAYMENT` and the caller is expected to
     * generate a Paystack link before confirming. Otherwise the booking is
     * `CONFIRMED` immediately.
     *
     * Returns both the booking and the (resolved) service so the caller can
     * branch without re-querying.
     */
    private async createBooking(context: BotContext): Promise<{ booking: any; service: any; requiresDeposit: boolean }> {
        // Tenant-scoped lookup so a manipulated context cannot book a service
        // belonging to another tenant.
        const service = await this.prisma.service.findFirstOrThrow({
            where: { id: context.serviceId, tenantId: this.tenantId, isActive: true },
        });

        const startTime = new Date(`${context.selectedDate}T${context.selectedTime}:00`);
        const endTime = new Date(startTime.getTime() + service.durationMinutes * 60 * 1000);
        const requiresDeposit = !!service.depositAmount && Number(service.depositAmount) > 0;

        // Atomic create: re-check the overlap inside the transaction so two
        // concurrent customers can't both grab the same slot. The window
        // between displaying the picker and the INSERT could be tens of
        // seconds; this collapses the race to a single SQL transaction.
        // Standard interval-overlap formula: existing.startTime < newEnd
        // AND existing.endTime > newStart.
        // `tx` is the transactional client; same shape as `this.prisma`.
        const booking = await this.prisma.$transaction(async (tx: typeof this.prisma) => {
            const overlap = await tx.booking.findFirst({
                where: {
                    tenantId: this.tenantId,
                    serviceId: service.id,
                    status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
                    AND: [
                        { startTime: { lt: endTime } },
                        { endTime: { gt: startTime } },
                    ],
                },
                select: { id: true },
            });
            if (overlap) {
                throw new BookingConflictError(overlap.id);
            }

            return tx.booking.create({
                data: {
                    tenantId: this.tenantId,
                    serviceId: service.id,
                    customerName: context.customerName!,
                    customerPhone: context.customerPhone!,
                    startTime,
                    endTime,
                    status: requiresDeposit ? 'PENDING_PAYMENT' : 'CONFIRMED',
                    bookingReference: this.generateReference(),
                    publicToken: generatePublicToken(),
                    depositAmount: requiresDeposit ? service.depositAmount : null,
                },
            });
        });
        return { booking, service, requiresDeposit };
    }

    private generateReference(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let ref = 'BK-';
        for (let i = 0; i < 6; i++) {
            ref += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return ref;
    }

    private async getProducts(): Promise<any[]> {
        return this.prisma.product.findMany({
            where: { tenantId: this.tenantId, isActive: true },
            take: 10,
            orderBy: { name: 'asc' },
        });
    }

    private formatCart(cart: BotContext['cart']): string {
        if (!cart || cart.length === 0) return 'Your cart is empty.';

        const items = cart.map(item =>
            `• ${item.productName} × ${item.quantity} = $${(item.price * item.quantity).toFixed(2)}`
        ).join('\n');

        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

        return `🛒 *Your Cart*\n\n${items}\n\n💰 Total: $${total.toFixed(2)}`;
    }

    /**
     * Start the checkout flow. Shared by every product-browsing state because
     * WhatsApp keeps old interactive buttons tappable — a customer can tap the
     * "Checkout" button from an earlier cart message while browsing products.
     */
    private pushCheckoutStart(context: BotContext, messages: SendMessagePayload[]): void {
        if (!context.cart || context.cart.length === 0) {
            messages.push(this.createTextMessage('Your cart is empty! Add items before checking out.'));
            messages.push(this.createProductMainMenu());
            context.state = BotState.MAIN_MENU;
        } else {
            messages.push(this.createTextMessage('Please enter your name:'));
            context.state = BotState.CHECKOUT;
        }
    }

    private async createOrder(context: BotContext): Promise<any> {
        const orderRef = this.generateOrderNumber();
        const total = context.cart!.reduce((sum, item) => sum + item.price * item.quantity, 0);

        const order = await this.prisma.order.create({
            data: {
                tenantId: this.tenantId,
                orderRef,
                customerName: context.customerName!,
                customerPhone: context.customerPhone!,
                deliveryAddress: context.deliveryAddress,
                status: 'PENDING',
                totalAmount: total,
                publicToken: generatePublicToken(),
                items: {
                    create: context.cart!.map(item => ({
                        productId: item.productId,
                        quantity: item.quantity,
                        unitPrice: item.price,
                    })),
                },
            },
        });

        return order;
    }

    private generateOrderNumber(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let ref = 'ORD-';
        for (let i = 0; i < 6; i++) {
            ref += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return ref;
    }

    /**
     * If the tenant has Paystack connected, initialise a Paystack transaction
     * for the given entity (order checkout total OR booking deposit) and
     * persist the reference + authorization URL on the right table.
     *
     * Returns the payment URL on success, or null when payments aren't
     * configured / the Paystack call fails. The entity stays UNPAID either
     * way — the webhook flips it to PAID on charge.success.
     */
    private async tryInitPaystackPayment(args: {
        entity: 'order' | 'booking';
        id: string;
        amount: number; // major unit
        customerPhone: string;
    }): Promise<string | null> {
        if (!this.paystackSecretKeyEncrypted) return null;

        try {
            const secretKey = decrypt(this.paystackSecretKeyEncrypted);
            const digits = args.customerPhone.replace(/[^0-9]/g, '');
            const callbackUrl = config.paystack.callbackUrl ?? (config.frontendUrl ? `${config.frontendUrl}/orders/paid` : undefined);

            const init = await initializeTransaction({
                secretKey,
                // Paystack rejects reserved TLDs like `.local` — use a real
                // public TLD for this placeholder email (customer never sees it).
                email: `${digits || 'customer'}@customer.bookingflow.app`,
                amountKobo: Math.round(args.amount * 100),
                currency: this.paymentCurrency,
                reference: `bf_${args.id}_${Date.now()}`,
                callbackUrl,
                metadata: {
                    tenantId: this.tenantId,
                    ...(args.entity === 'order'
                        ? { orderId: args.id }
                        : { bookingId: args.id }),
                    customerPhone: args.customerPhone,
                },
            });

            if (args.entity === 'order') {
                await this.prisma.order.update({
                    where: { id: args.id },
                    data: {
                        paymentReference: init.reference,
                        paymentAuthorizationUrl: init.authorizationUrl,
                    },
                });
            } else {
                await this.prisma.booking.update({
                    where: { id: args.id },
                    data: {
                        paymentReference: init.reference,
                        paymentAuthorizationUrl: init.authorizationUrl,
                    },
                });
            }

            return init.authorizationUrl;
        } catch (err) {
            // Non-fatal: log and let the caller fall back to the no-payment
            // confirmation. Staff can re-trigger from the dashboard.
            // eslint-disable-next-line no-console
            console.error('Paystack init failed during bot flow', err);
            return null;
        }
    }

    private async getCustomerOrders(phone: string): Promise<any[]> {
        return this.prisma.order.findMany({
            where: {
                tenantId: this.tenantId,
                customerPhone: phone,
            },
            include: { items: { include: { product: true } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });
    }

    private formatOrdersList(orders: any[]): string {
        return '📦 Your Recent Orders:\n\n' +
            orders.map(o =>
                `• Order #${o.orderRef}\n  Status: ${o.status}\n  Total: $${o.totalAmount}`
            ).join('\n\n');
    }

    private async sendMessage(to: string, payload: SendMessagePayload): Promise<void> {
        // Atomically reserve a quota slot. If the tenant is over their plan
        // cap we throw — the caller decides whether to surface a takeover or
        // increment botFailureCount. Either way the customer doesn't get a
        // silent drop they can't reason about.
        const reservation = await tryReserveOutbound(this.prisma, this.tenantId);
        if (!reservation.ok) {
            // eslint-disable-next-line no-console
            console.warn(
                JSON.stringify({
                    msg: 'bot_send_quota_exhausted',
                    tenantId: this.tenantId,
                    planId: reservation.planId,
                    used: reservation.used,
                    limit: reservation.limit,
                }),
            );
            throw new BotSendError(
                'quota_exhausted',
                `${reservation.planId} plan: ${reservation.used}/${reservation.limit}`,
            );
        }

        const { to: _ignored, ...messageData } = payload;

        try {
            const response = await fetch(
                `https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to,
                        ...messageData,
                    }),
                }
            );

            if (!response.ok) {
                const body = await response.text();
                // Rollback the reservation — Meta said no, no quota was used.
                await rollbackOutboundReservation(this.prisma, this.tenantId);
                console.error('WhatsApp API error:', body);
                throw new BotSendError('meta_error', `${response.status}: ${body.slice(0, 300)}`);
            }
            // Successful send — keep the reservation as the canonical counter.
        } catch (err) {
            if (err instanceof BotSendError) throw err;
            // Network error / fetch threw — rollback and re-wrap.
            await rollbackOutboundReservation(this.prisma, this.tenantId).catch(() => undefined);
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Failed to send WhatsApp message:', err);
            throw new BotSendError('network_error', msg);
        }
    }
}

export { WhatsAppBotEngine as default };
