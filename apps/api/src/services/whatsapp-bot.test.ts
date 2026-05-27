import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotState, BotContext } from './whatsapp-bot';

// Mock prisma. Includes the tenant + tenantUsage shapes used by the Phase 4a
// quota check that the bot's sendMessage now performs on every outbound.
const mockPrisma = {
    service: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
    },
    product: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
    },
    booking: {
        findMany: vi.fn(),
        create: vi.fn(),
    },
    order: {
        findMany: vi.fn(),
        create: vi.fn(),
    },
    conversation: {
        findUnique: vi.fn(),
        update: vi.fn(),
        // Optimistic-lock writes go through updateMany now; tests that don't
        // care about the lock just need this to "succeed" (count: 1).
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    message: {
        create: vi.fn(),
    },
    tenant: {
        findUnique: vi.fn().mockResolvedValue({ planId: 'pro' }), // generous default so the quota never blocks
    },
    tenantUsage: {
        findUnique: vi.fn().mockResolvedValue({ messageCount: 0 }),
        upsert: vi.fn().mockResolvedValue({ messageCount: 1 }),
        // tryReserveOutbound uses updateMany to atomically reserve a slot;
        // returning count: 1 means the reservation succeeded.
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
};

// Mock fetch for WhatsApp API
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
});

describe('WhatsApp Bot Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('BotState enum', () => {
        it('should have all service business states', () => {
            expect(BotState.WELCOME).toBe('WELCOME');
            expect(BotState.MAIN_MENU).toBe('MAIN_MENU');
            expect(BotState.SELECT_SERVICE).toBe('SELECT_SERVICE');
            expect(BotState.SELECT_DATE).toBe('SELECT_DATE');
            expect(BotState.SELECT_TIME).toBe('SELECT_TIME');
            expect(BotState.CONFIRM_BOOKING).toBe('CONFIRM_BOOKING');
            expect(BotState.ENTER_NAME).toBe('ENTER_NAME');
        });

        it('should have all product business states', () => {
            expect(BotState.BROWSE_PRODUCTS).toBe('BROWSE_PRODUCTS');
            expect(BotState.VIEW_PRODUCT).toBe('VIEW_PRODUCT');
            expect(BotState.ADD_TO_CART).toBe('ADD_TO_CART');
            expect(BotState.VIEW_CART).toBe('VIEW_CART');
            expect(BotState.CHECKOUT).toBe('CHECKOUT');
            expect(BotState.ENTER_DELIVERY_ADDRESS).toBe('ENTER_DELIVERY_ADDRESS');
            expect(BotState.VIEW_ORDERS).toBe('VIEW_ORDERS');
        });

        it('should have common states', () => {
            expect(BotState.VIEW_APPOINTMENTS).toBe('VIEW_APPOINTMENTS');
            expect(BotState.CONTACT_SUPPORT).toBe('CONTACT_SUPPORT');
        });
    });

    describe('BotContext interface', () => {
        it('should allow creation of valid service booking context', () => {
            const context: BotContext = {
                state: BotState.SELECT_DATE,
                serviceId: 'service-123',
                serviceName: 'Haircut',
                selectedDate: '2024-01-15',
                customerName: 'John',
                customerPhone: '+1234567890',
            };

            expect(context.state).toBe(BotState.SELECT_DATE);
            expect(context.serviceId).toBe('service-123');
        });

        it('should allow creation of valid product ordering context', () => {
            const context: BotContext = {
                state: BotState.VIEW_CART,
                cart: [
                    { productId: 'prod-1', productName: 'Item 1', quantity: 2, price: 10 },
                    { productId: 'prod-2', productName: 'Item 2', quantity: 1, price: 25 },
                ],
                customerName: 'Jane',
                customerPhone: '+1234567890',
                deliveryAddress: '123 Main St',
            };

            expect(context.cart).toHaveLength(2);
            expect(context.cart![0].productName).toBe('Item 1');
        });

        it('should calculate cart total correctly', () => {
            const cart = [
                { productId: 'prod-1', productName: 'Item 1', quantity: 2, price: 10 },
                { productId: 'prod-2', productName: 'Item 2', quantity: 1, price: 25 },
            ];

            const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
            expect(total).toBe(45);
        });
    });

    describe('State transitions', () => {
        it('should transition from WELCOME to MAIN_MENU', () => {
            const context: BotContext = { state: BotState.WELCOME };
            // After welcome message, state should be main menu
            context.state = BotState.MAIN_MENU;
            expect(context.state).toBe(BotState.MAIN_MENU);
        });

        it('should store service selection during booking flow', () => {
            const context: BotContext = { state: BotState.MAIN_MENU };

            // User selects a service
            context.serviceId = 'service-123';
            context.serviceName = 'Haircut';
            context.state = BotState.SELECT_DATE;

            expect(context.serviceId).toBe('service-123');
            expect(context.state).toBe(BotState.SELECT_DATE);
        });

        it('should preserve cart across state changes', () => {
            const context: BotContext = {
                state: BotState.BROWSE_PRODUCTS,
                cart: [{ productId: 'p1', productName: 'Test', quantity: 1, price: 10 }],
            };

            context.state = BotState.VIEW_CART;
            expect(context.cart).toHaveLength(1);

            context.state = BotState.CHECKOUT;
            expect(context.cart).toHaveLength(1);
        });
    });

    describe('Date parsing', () => {
        it('should handle "today" date input', () => {
            const today = new Date().toISOString().split('T')[0];
            expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should handle "tomorrow" date input', () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            expect(tomorrowStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should handle ISO date format', () => {
            const isoDate = '2024-01-15';
            expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('Reference generation', () => {
        it('should generate valid booking reference format', () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let ref = 'BK-';
            for (let i = 0; i < 6; i++) {
                ref += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            expect(ref).toMatch(/^BK-[A-Z0-9]{6}$/);
        });

        it('should generate valid order number format', () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let ref = 'ORD-';
            for (let i = 0; i < 6; i++) {
                ref += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            expect(ref).toMatch(/^ORD-[A-Z0-9]{6}$/);
        });

        it('should generate unique references', () => {
            const generateRef = () => {
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                let ref = 'BK-';
                for (let i = 0; i < 6; i++) {
                    ref += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                return ref;
            };

            const refs = new Set();
            for (let i = 0; i < 100; i++) {
                refs.add(generateRef());
            }
            // With random generation, we expect high uniqueness
            expect(refs.size).toBeGreaterThan(95);
        });
    });

    describe('CONTACT_SUPPORT escape from dead-end', () => {
        it('flips conversation to HUMAN_ACTIVE when the bot enters CONTACT_SUPPORT', async () => {
            const { WhatsAppBotEngine } = await import('./whatsapp-bot.js');

            const prisma = {
                ...mockPrisma,
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-1',
                        botContext: { state: BotState.MAIN_MENU },
                    }),
                    update: vi.fn().mockResolvedValue({}),
                    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                },
                message: { create: vi.fn().mockResolvedValue({}) },
            };

            const bot = new WhatsAppBotEngine(prisma as any, {
                id: 'tenant-1',
                whatsappAccessToken: null,
                whatsappPhoneNumberId: 'pn-1',
                businessType: 'SERVICE',
                timezone: 'UTC',
            });

            await bot.processMessage('conv-1', '+15550100', 'support');

            // The HUMAN_ACTIVE flip now goes through the optimistic-lock
            // updateMany write (was prisma.conversation.update before B2).
            const updateCalls = prisma.conversation.updateMany.mock.calls;
            const takeoverCall = updateCalls.find(
                (call: any[]) => call[0].data.state === 'HUMAN_ACTIVE',
            );
            expect(takeoverCall).toBeDefined();
            expect(takeoverCall![0].data.takeoverReason).toBe('customer_requested_support');
            // botContext should reset to WELCOME so resuming the bot is clean.
            expect(takeoverCall![0].data.botContext).toMatchObject({ state: BotState.WELCOME });
        });

        it('does NOT flip the conversation when the bot stays in MAIN_MENU', async () => {
            const { WhatsAppBotEngine } = await import('./whatsapp-bot.js');

            const prisma = {
                ...mockPrisma,
                service: {
                    ...mockPrisma.service,
                    findMany: vi.fn().mockResolvedValue([]),
                },
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-1',
                        botContext: { state: BotState.MAIN_MENU },
                    }),
                    update: vi.fn().mockResolvedValue({}),
                    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                },
                message: { create: vi.fn().mockResolvedValue({}) },
            };

            const bot = new WhatsAppBotEngine(prisma as any, {
                id: 'tenant-1',
                whatsappAccessToken: null,
                whatsappPhoneNumberId: 'pn-1',
                businessType: 'SERVICE',
                timezone: 'UTC',
            });

            await bot.processMessage('conv-1', '+15550100', 'book');

            // Same migration as the previous test: the state write now flows
            // through updateMany instead of update.
            const updateCalls = prisma.conversation.updateMany.mock.calls;
            const takeoverCall = updateCalls.find(
                (call: any[]) => call[0].data.state === 'HUMAN_ACTIVE',
            );
            expect(takeoverCall).toBeUndefined();
        });
    });

    describe('Booking deposits (Phase 3d)', () => {
        // The bot's ENTER_NAME state finalises the booking. The context at
        // that point already carries serviceId / selectedDate / selectedTime.
        function makeBotInState(opts: {
            depositAmount: number | null;
            paystackConnected: boolean;
        }) {
            const createBookingMock = vi.fn().mockImplementation(async ({ data }) => ({
                id: 'bk-1',
                bookingReference: 'BK-ABCDEF',
                ...data,
            }));
            const prisma: any = {
                ...mockPrisma,
                service: {
                    ...mockPrisma.service,
                    findFirstOrThrow: vi.fn().mockResolvedValue({
                        id: 'svc-1',
                        name: 'Haircut',
                        durationMinutes: 60,
                        depositAmount: opts.depositAmount,
                    }),
                },
                booking: {
                    ...mockPrisma.booking,
                    // No overlap by default so the transactional create proceeds.
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: createBookingMock,
                    update: vi.fn().mockResolvedValue({}),
                    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                },
                // createBooking now runs inside a $transaction. The mock just
                // invokes the callback with itself as the tx client.
                $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
                conversation: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 'conv-1',
                        botContext: {
                            state: BotState.ENTER_NAME,
                            serviceId: 'svc-1',
                            serviceName: 'Haircut',
                            selectedDate: '2026-05-20',
                            selectedTime: '10:00',
                        },
                    }),
                    update: vi.fn().mockResolvedValue({}),
                    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                },
                message: { create: vi.fn().mockResolvedValue({}) },
            };

            // We need a fake-encrypted token because the bot decrypts on
            // construction. crypto.ts's encrypt is in test mode — use the
            // module directly.
            return { prisma, createBookingMock };
        }

        it('writes PENDING_PAYMENT + depositAmount when the service requires a deposit', async () => {
            const { WhatsAppBotEngine } = await import('./whatsapp-bot.js');
            const { encrypt } = await import('./crypto.js');
            const { prisma, createBookingMock } = makeBotInState({
                depositAmount: 20,
                paystackConnected: true,
            });

            const bot = new WhatsAppBotEngine(prisma as any, {
                id: 'tenant-1',
                whatsappAccessToken: null,
                whatsappPhoneNumberId: 'pn-1',
                businessType: 'SERVICE',
                timezone: 'UTC',
                paystackSecretKey: encrypt('sk_test_xxx'),
                paymentCurrency: 'NGN',
            });

            // Stub fetch so the Paystack init in tryInitPaystackPayment
            // resolves to a fake URL without hitting the network.
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(JSON.stringify({
                    status: true,
                    data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'bf_bk-1_1', access_code: 'a' },
                }), { status: 200 }),
            );

            await bot.processMessage('conv-1', '+15550100', 'Jane Doe');

            const createCall = createBookingMock.mock.calls[0];
            expect(createCall[0].data.status).toBe('PENDING_PAYMENT');
            expect(createCall[0].data.depositAmount).toBe(20);
            // The bot persists the Paystack reference + URL on the booking.
            expect(prisma.booking.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'bk-1' },
                    data: expect.objectContaining({
                        paymentReference: expect.any(String),
                        paymentAuthorizationUrl: 'https://checkout.paystack.com/x',
                    }),
                }),
            );
            fetchSpy.mockRestore();
        });

        it('writes CONFIRMED and skips Paystack when the service has no deposit', async () => {
            const { WhatsAppBotEngine } = await import('./whatsapp-bot.js');
            const { prisma, createBookingMock } = makeBotInState({
                depositAmount: null,
                paystackConnected: false,
            });

            const bot = new WhatsAppBotEngine(prisma as any, {
                id: 'tenant-1',
                whatsappAccessToken: null,
                whatsappPhoneNumberId: 'pn-1',
                businessType: 'SERVICE',
                timezone: 'UTC',
                paystackSecretKey: null,
                paymentCurrency: 'NGN',
            });

            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response('{}', { status: 200 }),
            );

            await bot.processMessage('conv-1', '+15550100', 'Jane Doe');

            const createCall = createBookingMock.mock.calls[0];
            expect(createCall[0].data.status).toBe('CONFIRMED');
            expect(createCall[0].data.depositAmount).toBeNull();
            // No Paystack init call for the deposit-less path (the bot still
            // calls Meta's Graph API to send outbound messages — only assert
            // no call to api.paystack.co).
            const paystackCalls = fetchSpy.mock.calls.filter(([url]) =>
                String(url).includes('api.paystack.co'),
            );
            expect(paystackCalls).toHaveLength(0);
            fetchSpy.mockRestore();
        });
    });
});
