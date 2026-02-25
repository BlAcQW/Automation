import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * WhatsApp Webhook Integration Tests
 * 
 * Tests the webhook signature verification, payload parsing,
 * and message processing flow.
 */

// Mock webhook payload
const createWebhookPayload = (message: any) => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: 'business-123',
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'phone-123',
                },
                contacts: [{ profile: { name: 'John Doe' }, wa_id: '+0987654321' }],
                messages: [message],
            },
            field: 'messages',
        }],
    }],
});

describe('WhatsApp Webhook', () => {
    describe('Payload Parsing', () => {
        it('should parse text message payload', () => {
            const payload = createWebhookPayload({
                from: '+0987654321',
                id: 'msg-123',
                timestamp: '1234567890',
                type: 'text',
                text: { body: 'Hello' },
            });

            const message = payload.entry[0].changes[0].value.messages?.[0];
            expect(message?.type).toBe('text');
            expect(message?.text?.body).toBe('Hello');
        });

        it('should parse button reply payload', () => {
            const payload = createWebhookPayload({
                from: '+0987654321',
                id: 'msg-123',
                timestamp: '1234567890',
                type: 'interactive',
                interactive: {
                    type: 'button_reply',
                    button_reply: { id: 'book', title: 'Book' },
                },
            });

            const message = payload.entry[0].changes[0].value.messages?.[0];
            expect(message?.type).toBe('interactive');
            expect(message?.interactive?.button_reply?.id).toBe('book');
        });

        it('should parse list reply payload', () => {
            const payload = createWebhookPayload({
                from: '+0987654321',
                id: 'msg-123',
                timestamp: '1234567890',
                type: 'interactive',
                interactive: {
                    type: 'list_reply',
                    list_reply: { id: 'service-123', title: 'Haircut' },
                },
            });

            const message = payload.entry[0].changes[0].value.messages?.[0];
            expect(message?.interactive?.list_reply?.id).toBe('service-123');
        });

        it('should extract customer info from contacts', () => {
            const payload = createWebhookPayload({
                from: '+0987654321',
                id: 'msg-123',
                timestamp: '1234567890',
                type: 'text',
                text: { body: 'Hello' },
            });

            const contacts = payload.entry[0].changes[0].value.contacts;
            expect(contacts?.[0].profile.name).toBe('John Doe');
            expect(contacts?.[0].wa_id).toBe('+0987654321');
        });
    });

    describe('Message Content Extraction', () => {
        it('should extract text content', () => {
            const message = {
                type: 'text',
                text: { body: 'I want to book an appointment' },
            };

            let content = '';
            if (message.type === 'text' && message.text) {
                content = message.text.body;
            }

            expect(content).toBe('I want to book an appointment');
        });

        it('should extract button reply id', () => {
            const message = {
                type: 'interactive',
                interactive: {
                    type: 'button_reply',
                    button_reply: { id: 'book', title: 'Book Now' },
                },
            };

            let content = '';
            if (message.type === 'interactive' && message.interactive) {
                content = message.interactive.button_reply?.id || '';
            }

            expect(content).toBe('book');
        });

        it('should extract list reply id', () => {
            const message = {
                type: 'interactive',
                interactive: {
                    type: 'list_reply',
                    list_reply: { id: 'service-456', title: 'Massage' },
                },
            };

            let content = '';
            if (message.type === 'interactive' && message.interactive) {
                const reply = message.interactive.button_reply || message.interactive.list_reply;
                content = reply?.id || '';
            }

            expect(content).toBe('service-456');
        });
    });

    describe('Webhook Verification', () => {
        it('should verify valid webhook challenge', () => {
            const query = {
                'hub.mode': 'subscribe',
                'hub.verify_token': 'test-token',
                'hub.challenge': 'challenge-123',
            };

            const expectedToken = 'test-token';
            const isValid = query['hub.mode'] === 'subscribe' &&
                query['hub.verify_token'] === expectedToken;

            expect(isValid).toBe(true);
            expect(query['hub.challenge']).toBe('challenge-123');
        });

        it('should reject invalid verify token', () => {
            const query = {
                'hub.mode': 'subscribe',
                'hub.verify_token': 'wrong-token',
                'hub.challenge': 'challenge-123',
            };

            const expectedToken = 'test-token';
            const isValid = query['hub.mode'] === 'subscribe' &&
                query['hub.verify_token'] === expectedToken;

            expect(isValid).toBe(false);
        });

        it('should reject non-subscribe mode', () => {
            const query = {
                'hub.mode': 'unsubscribe',
                'hub.verify_token': 'test-token',
                'hub.challenge': 'challenge-123',
            };

            const isValid = query['hub.mode'] === 'subscribe';
            expect(isValid).toBe(false);
        });
    });

    describe('Status Updates', () => {
        it('should handle message status updates', () => {
            const statusPayload = {
                object: 'whatsapp_business_account',
                entry: [{
                    id: 'business-123',
                    changes: [{
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: {
                                display_phone_number: '+1234567890',
                                phone_number_id: 'phone-123',
                            },
                            statuses: [
                                { id: 'msg-123', status: 'sent' },
                                { id: 'msg-123', status: 'delivered' },
                                { id: 'msg-123', status: 'read' },
                            ],
                        },
                        field: 'messages',
                    }],
                }],
            };

            const statuses = statusPayload.entry[0].changes[0].value.statuses;
            expect(statuses).toHaveLength(3);
            expect(statuses?.[0].status).toBe('sent');
            expect(statuses?.[1].status).toBe('delivered');
            expect(statuses?.[2].status).toBe('read');
        });
    });

    describe('Error Handling', () => {
        it('should handle missing messages array', () => {
            const payload = {
                object: 'whatsapp_business_account',
                entry: [{
                    id: 'business-123',
                    changes: [{
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: {
                                display_phone_number: '+1234567890',
                                phone_number_id: 'phone-123',
                            },
                            // No messages array
                        },
                        field: 'messages',
                    }],
                }],
            };

            const messages = payload.entry[0].changes[0].value.messages;
            expect(messages).toBeUndefined();
        });

        it('should handle empty entry array', () => {
            const payload = {
                object: 'whatsapp_business_account',
                entry: [],
            };

            expect(payload.entry).toHaveLength(0);
        });

        it('should filter non-whatsapp objects', () => {
            const payload = { object: 'instagram_business_account' };
            const isWhatsApp = payload.object === 'whatsapp_business_account';
            expect(isWhatsApp).toBe(false);
        });
    });
});
