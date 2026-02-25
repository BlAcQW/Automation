import { config } from '../config/index.js';
import { decrypt } from './crypto.js';

// Bot conversation states
export enum BotState {
    WELCOME = 'WELCOME',
    MAIN_MENU = 'MAIN_MENU',
    // Service business states
    SELECT_SERVICE = 'SELECT_SERVICE',
    SELECT_DATE = 'SELECT_DATE',
    SELECT_TIME = 'SELECT_TIME',
    CONFIRM_BOOKING = 'CONFIRM_BOOKING',
    ENTER_NAME = 'ENTER_NAME',
    ENTER_PHONE = 'ENTER_PHONE',
    VIEW_APPOINTMENTS = 'VIEW_APPOINTMENTS',
    // Product business states
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
    type: 'text' | 'interactive';
    text?: { body: string };
    interactive?: any;
}

// Main bot engine class
export class WhatsAppBotEngine {
    private prisma: any;
    private tenantId: string;
    private accessToken: string;
    private phoneNumberId: string;
    private businessType: 'SERVICE' | 'PRODUCT';

    constructor(prisma: any, tenant: any) {
        this.prisma = prisma;
        this.tenantId = tenant.id;
        // Decrypt the stored access token
        this.accessToken = tenant.whatsappAccessToken ? decrypt(tenant.whatsappAccessToken) : '';
        this.phoneNumberId = tenant.whatsappPhoneNumberId;
        this.businessType = tenant.businessType || 'SERVICE';
    }

    // Process incoming message and generate response
    async processMessage(conversationId: string, customerPhone: string, content: string): Promise<void> {
        // Get conversation with context
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });

        // Parse context
        let context: BotContext = conversation.botContext
            ? JSON.parse(conversation.botContext as string)
            : { state: BotState.WELCOME };

        // Process based on state
        const response = await this.handleState(context, content, customerPhone);

        // Update conversation with new context
        await this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
                botContext: JSON.stringify(context),
                updatedAt: new Date(),
            },
        });

        // Send response(s)
        for (const msg of response.messages) {
            await this.sendMessage(customerPhone, msg);

            // Store outbound message
            await this.prisma.message.create({
                data: {
                    conversationId,
                    direction: 'OUTBOUND',
                    content: typeof msg.text?.body === 'string' ? msg.text.body : '[Interactive Message]',
                    messageType: msg.type.toUpperCase(),
                    isFromBot: true,
                },
            });
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
                        } else {
                            messages.push(this.createTextMessage(this.formatBookingsList(bookings)));
                        }
                        messages.push(this.createMainMenu());
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
                    messages.push(this.createTextMessage(`Great choice! ${service.name} (${service.duration} min, $${service.price})`));
                    messages.push(this.createTextMessage('Please enter your preferred date (e.g., "tomorrow", "Monday", or "2024-01-15"):'));
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
                        messages.push(this.createTextMessage('Sorry, no available times on that date. Please try another date:'));
                    } else {
                        messages.push(this.createTimeList(times));
                        context.state = BotState.SELECT_TIME;
                    }
                } else {
                    messages.push(this.createTextMessage('I couldn\'t parse that date. Please try again (e.g., "tomorrow" or "2024-01-15"):'));
                }
                break;

            case BotState.SELECT_TIME:
                if (content.match(/^\d{2}:\d{2}$/)) {
                    context.selectedTime = content;
                    messages.push(this.createTextMessage('Almost done! Please enter your name:'));
                    context.state = BotState.ENTER_NAME;
                } else {
                    messages.push(this.createTextMessage('Please select a valid time from the options.'));
                }
                break;

            case BotState.ENTER_NAME:
                context.customerName = content.trim();
                context.customerPhone = customerPhone;
                try {
                    const booking = await this.createBooking(context);
                    messages.push(this.createTextMessage(
                        `✅ Booking Confirmed!\n\n` +
                        `📋 ${context.serviceName}\n` +
                        `📅 ${context.selectedDate}\n` +
                        `⏰ ${context.selectedTime}\n` +
                        `👤 ${context.customerName}\n\n` +
                        `Reference: ${booking.bookingReference}\n\n` +
                        `We'll send you a reminder before your appointment!`
                    ));
                } catch (err) {
                    messages.push(this.createTextMessage('Sorry, there was an error creating your booking. Please try again.'));
                }
                messages.push(this.createMainMenu());
                context.state = BotState.MAIN_MENU;
                break;

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
                } else {
                    const product = await this.prisma.product.findFirst({
                        where: { tenantId: this.tenantId, id: content, isActive: true },
                    });
                    if (product) {
                        context.currentProductId = product.id;
                        messages.push(this.createTextMessage(
                            `📦 *${product.name}*\n\n` +
                            `${product.description || ''}\n\n` +
                            `💰 Price: $${product.price}\n` +
                            `📊 In Stock: ${product.stockQuantity > 0 ? 'Yes' : 'Out of Stock'}`
                        ));
                        if (product.stockQuantity > 0) {
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
                } else {
                    messages.push(this.createAddToCartMenu());
                }
                break;

            case BotState.VIEW_CART:
                if (content === 'checkout') {
                    if (!context.cart || context.cart.length === 0) {
                        messages.push(this.createTextMessage('Your cart is empty!'));
                        messages.push(this.createProductMainMenu());
                        context.state = BotState.MAIN_MENU;
                    } else {
                        messages.push(this.createTextMessage('Please enter your name:'));
                        context.state = BotState.CHECKOUT;
                    }
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
                    messages.push(this.createTextMessage(
                        `✅ Order Placed!\n\n` +
                        `📦 Order #${order.orderNumber}\n` +
                        `👤 ${context.customerName}\n` +
                        `📍 ${context.deliveryAddress}\n` +
                        `💰 Total: $${total.toFixed(2)}\n\n` +
                        `We'll notify you when your order is on its way!`
                    ));
                    context.cart = [];
                } catch (err) {
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
                // Forward to human - this state triggers takeover
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
                            description: `${s.duration} min - $${s.price}`,
                        })),
                    }],
                },
            },
        };
    }

    private createTimeList(times: string[]): SendMessagePayload {
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
                        rows: times.map(t => ({
                            id: t,
                            title: t,
                        })),
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
                            description: `$${p.price}${p.stockQuantity <= 0 ? ' (Out of stock)' : ''}`,
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
        // Simplified - would normally check availability and existing bookings
        return ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
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

    private async createBooking(context: BotContext): Promise<any> {
        const service = await this.prisma.service.findUnique({
            where: { id: context.serviceId },
        });

        const startTime = new Date(`${context.selectedDate}T${context.selectedTime}:00`);
        const endTime = new Date(startTime.getTime() + service.duration * 60 * 1000);

        return this.prisma.booking.create({
            data: {
                tenantId: this.tenantId,
                serviceId: context.serviceId,
                customerName: context.customerName,
                customerPhone: context.customerPhone,
                startTime,
                endTime,
                status: 'CONFIRMED',
                bookingReference: this.generateReference(),
            },
        });
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

    private async createOrder(context: BotContext): Promise<any> {
        const orderNumber = this.generateOrderNumber();
        const total = context.cart!.reduce((sum, item) => sum + item.price * item.quantity, 0);

        const order = await this.prisma.order.create({
            data: {
                tenantId: this.tenantId,
                orderNumber,
                customerName: context.customerName,
                customerPhone: context.customerPhone,
                deliveryAddress: context.deliveryAddress,
                status: 'PENDING',
                totalAmount: total,
                items: {
                    create: context.cart!.map(item => ({
                        productId: item.productId,
                        quantity: item.quantity,
                        unitPrice: item.price,
                        totalPrice: item.price * item.quantity,
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
                `• Order #${o.orderNumber}\n  Status: ${o.status}\n  Total: $${o.totalAmount}`
            ).join('\n\n');
    }

    private async sendMessage(to: string, payload: SendMessagePayload): Promise<void> {
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
                console.error('WhatsApp API error:', await response.text());
            }
        } catch (err) {
            console.error('Failed to send WhatsApp message:', err);
        }
    }
}

export { WhatsAppBotEngine as default };
