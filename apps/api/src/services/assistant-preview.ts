/**
 * Settings > Try your assistant: one question through the real assistant for
 * this business, with nothing written and nothing sent.
 *
 * It is the same runAgent the inbox uses, in preview mode (see AgentContext.preview):
 * no conversation, no chat history, no customer (so no memory and no staff
 * note), and only the read-only tools run. No Message, Conversation, Booking or
 * Order row is created, no takeover happens, no payment link is made (and no
 * Paystack key is even handed over), and the reply goes back to the dashboard
 * only.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import type { KnowledgeDto } from './business-knowledge.js';
import { runAgent } from './llm-agent.js';

export interface PreviewArgs {
    tenantId: string;
    question: string;
    /** Unsaved knowledge from the form; omitted = the saved knowledge. */
    knowledge?: KnowledgeDto;
    log?: FastifyBaseLogger;
}

export interface PreviewResult {
    /** What the assistant would reply. '' when it would only hand over. */
    reply: string;
    /** True when, in a real chat, it would hand the conversation to the team. */
    handedToTeam: boolean;
}

export class PreviewTenantNotFound extends Error {
    constructor() {
        super('Business not found');
        this.name = 'PreviewTenantNotFound';
    }
}

export async function previewAssistant(prisma: ExtendedPrismaClient, args: PreviewArgs): Promise<PreviewResult> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: args.tenantId },
        select: {
            name: true, timezone: true, paymentCurrency: true, businessType: true,
            depositRequired: true, defaultDepositAmount: true,
        },
    });
    if (!tenant) throw new PreviewTenantNotFound();

    const result = await runAgent(
        {
            prisma,
            tenantId: args.tenantId,
            tenantName: tenant.name,
            timezone: tenant.timezone ?? 'UTC',
            currency: tenant.paymentCurrency ?? 'GHS',
            // Never needed: no tool that makes a payment link runs in a preview.
            paystackSecretKeyEncrypted: null,
            businessType: tenant.businessType ?? 'SERVICE',
            depositRequired: tenant.depositRequired ?? true,
            defaultDepositAmount: tenant.defaultDepositAmount ?? 50,
            conversationId: '',
            customerPhone: '',
            channel: 'WHATSAPP',
            phoneVerified: false,
            businessPhone: null,
            queues: null,
            log: args.log,
            preview: true,
            ...(args.knowledge ? { knowledgeOverride: args.knowledge } : {}),
        },
        args.question,
    );

    return { reply: result.reply, handedToTeam: result.wantsHuman };
}
