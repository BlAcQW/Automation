import type { MessageTemplate } from '@prisma/client';

/**
 * Meta WhatsApp Cloud API template message payload.
 *
 * Only the BODY component is rendered here. Templates that include header
 * media, buttons with dynamic URLs, or location parameters need a richer
 * builder — deferred to Phase 3 when we add Meta Business Management API
 * integration.
 */
export interface MetaTemplatePayload {
    messaging_product: 'whatsapp';
    recipient_type: 'individual';
    to: string;
    type: 'template';
    template: {
        name: string;
        language: { code: string };
        components?: Array<{
            type: 'body';
            parameters: Array<{ type: 'text'; text: string }>;
        }>;
    };
}

export interface SendTemplateArgs {
    accessToken: string;
    phoneNumberId: string;
    to: string;
    template: Pick<MessageTemplate, 'name' | 'language' | 'variableCount'>;
    variables: string[];
}

export interface SendTemplateResult {
    ok: boolean;
    error?: string;
    messageId?: string;
}

const GRAPH_API_VERSION = 'v18.0';

export function buildTemplatePayload(
    template: Pick<MessageTemplate, 'name' | 'language'>,
    to: string,
    variables: string[],
): MetaTemplatePayload {
    const payload: MetaTemplatePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
            name: template.name,
            language: { code: template.language },
        },
    };

    if (variables.length > 0) {
        payload.template.components = [
            {
                type: 'body',
                parameters: variables.map((v) => ({ type: 'text', text: v })),
            },
        ];
    }

    return payload;
}

/**
 * Send a template-type message via the WhatsApp Cloud API.
 *
 * Returns `{ ok: false }` on:
 *   - variable count mismatch (no API call made — caller should NOT retry)
 *   - HTTP non-2xx (caller MAY retry)
 *   - network/JSON errors (caller MAY retry)
 *
 * Never throws — the caller decides whether to retry based on the error code.
 */
export async function sendTemplateMessage(args: SendTemplateArgs): Promise<SendTemplateResult> {
    if (args.variables.length !== args.template.variableCount) {
        return {
            ok: false,
            error: `variable_count_mismatch: template expects ${args.template.variableCount}, got ${args.variables.length}`,
        };
    }

    const payload = buildTemplatePayload(args.template, args.to, args.variables);

    let response: Response;
    try {
        response = await fetch(
            `https://graph.facebook.com/${GRAPH_API_VERSION}/${args.phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${args.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            },
        );
    } catch (err) {
        return { ok: false, error: `network_error: ${(err as Error).message}` };
    }

    if (!response.ok) {
        let errorBody = '';
        try {
            errorBody = await response.text();
        } catch {
            /* ignore */
        }
        return { ok: false, error: `http_${response.status}: ${errorBody.slice(0, 500)}` };
    }

    try {
        const body = (await response.json()) as { messages?: Array<{ id: string }> };
        return { ok: true, messageId: body.messages?.[0]?.id };
    } catch {
        return { ok: true };
    }
}
