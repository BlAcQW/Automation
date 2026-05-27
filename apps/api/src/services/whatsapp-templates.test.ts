import { describe, it, expect, vi, afterEach } from 'vitest';
import { TemplateCategory, TemplatePurpose } from '@prisma/client';
import { buildTemplatePayload, sendTemplateMessage } from './whatsapp-templates';

const template = {
    id: 'tpl-1',
    tenantId: 'tenant-1',
    name: 'booking_confirmation_v1',
    language: 'en_US',
    category: TemplateCategory.UTILITY,
    purpose: TemplatePurpose.BOOKING_CONFIRMATION,
    bodyPreview: null,
    variableCount: 3,
    isApproved: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('buildTemplatePayload', () => {
    it('omits components when there are no variables', () => {
        const payload = buildTemplatePayload(
            { name: 'hello', language: 'en_US' },
            '+15551234567',
            [],
        );
        expect(payload.type).toBe('template');
        expect(payload.template.name).toBe('hello');
        expect(payload.template.language).toEqual({ code: 'en_US' });
        expect(payload.template.components).toBeUndefined();
    });

    it('builds a body component with positional parameters', () => {
        const payload = buildTemplatePayload(
            { name: template.name, language: template.language },
            '+15551234567',
            ['John', 'Haircut', '10:00'],
        );
        expect(payload.template.components).toEqual([
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: 'John' },
                    { type: 'text', text: 'Haircut' },
                    { type: 'text', text: '10:00' },
                ],
            },
        ]);
    });
});

describe('sendTemplateMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects variable-count mismatch without calling Meta', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const result = await sendTemplateMessage({
            accessToken: 'tok',
            phoneNumberId: 'pn-1',
            to: '+1',
            template,
            variables: ['only-one'],
        });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/variable_count_mismatch/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns ok + messageId on a 200 response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ messages: [{ id: 'wamid.abc' }] }), { status: 200 }),
        );

        const result = await sendTemplateMessage({
            accessToken: 'tok',
            phoneNumberId: 'pn-1',
            to: '+1',
            template,
            variables: ['a', 'b', 'c'],
        });

        expect(result.ok).toBe(true);
        expect(result.messageId).toBe('wamid.abc');
    });

    it('returns retryable error on Meta 5xx', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('upstream meltdown', { status: 502 }),
        );

        const result = await sendTemplateMessage({
            accessToken: 'tok',
            phoneNumberId: 'pn-1',
            to: '+1',
            template,
            variables: ['a', 'b', 'c'],
        });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/http_502/);
    });

    it('returns network_error when fetch throws', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection reset'));

        const result = await sendTemplateMessage({
            accessToken: 'tok',
            phoneNumberId: 'pn-1',
            to: '+1',
            template,
            variables: ['a', 'b', 'c'],
        });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/network_error/);
    });
});
