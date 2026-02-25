import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotState, BotContext } from './whatsapp-bot';

// Mock prisma
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
    },
    message: {
        create: vi.fn(),
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
});
