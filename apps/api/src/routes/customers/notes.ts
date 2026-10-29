/**
 * Staff notes on customers (any staff member may read and write; every change
 * is audited, without the text).
 *
 *   GET/PUT /customers/:customerId/note
 *   GET/PUT /customers/by-conversation/:conversationId/note
 *
 * The by-conversation pair is what the inbox and the customers page use: a
 * chat may not have a Customer record yet. Saving from a VERIFIED WhatsApp chat
 * creates and links one, the same way inbound messages do; a username-only or
 * Instagram / Messenger chat is refused (409), because the only phone it has
 * was typed by the customer (RULE-2).
 *
 * Registered inside customersRoutes, so it inherits its authenticate hook.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import {
    findCustomerNote,
    findNoteCustomer,
    noteBodySchema,
    noteEligibility,
    resolveNoteCustomerForWrite,
    saveCustomerNote,
    type NoteConversation,
    type NoteCustomer,
} from '../../services/customer-notes.js';

const idParam = z.object({ id: z.string().min(1).max(64) });

/** Plenty for a team typing notes; stops a script hammering the customer table. */
const NOTE_WRITE_LIMIT = {
    rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `${req.user?.tenantId ?? req.ip}:customer-note` },
};

const NOT_VERIFIED =
    'Notes can only be saved for customers with a verified WhatsApp number. This chat has no verified number yet.';

const customerNotesRoutes: FastifyPluginAsync = async (fastify) => {
    async function noteView(tenantId: string, c: NoteCustomer | null) {
        const by = c?.notesUpdatedByUserId
            ? await fastify.prisma.user.findFirst({ where: { id: c.notesUpdatedByUserId, tenantId }, select: { name: true } })
            : null;
        return {
            customerId: c?.id ?? null,
            note: c?.notes ?? '',
            updatedAt: c?.notesUpdatedAt ? new Date(c.notesUpdatedAt).toISOString() : null,
            updatedBy: by ? { name: by.name } : null,
        };
    }

    async function recordChange(request: FastifyRequest, customerId: string, note: string, via: 'customer' | 'conversation') {
        await audit({
            prisma: fastify.prisma,
            action: 'customer.note_updated',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            targetType: 'Customer',
            targetId: customerId,
            // Never the text: it can hold personal details.
            metadata: { length: note.length, cleared: note === '', via },
            ipAddress: request.ip,
        });
    }

    async function loadConversation(tenantId: string, id: string): Promise<NoteConversation> {
        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId },
            select: { id: true, channel: true, externalId: true, customerPhone: true, customerId: true },
        });
        if (!conversation) throw fastify.httpErrors.notFound('Conversation not found');
        return conversation;
    }

    fastify.get('/:id/note', async (request) => {
        const { id } = idParam.parse(request.params);
        const customer = await findCustomerNote(fastify.prisma, request.user.tenantId, id);
        if (!customer) throw fastify.httpErrors.notFound('Customer not found');
        return noteView(request.user.tenantId, customer);
    });

    fastify.put('/:id/note', { config: NOTE_WRITE_LIMIT }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { note } = noteBodySchema.parse(request.body);
        const { tenantId, userId } = request.user;
        const saved = await saveCustomerNote(fastify.prisma, { tenantId, customerId: id, note, userId });
        if (!saved) throw fastify.httpErrors.notFound('Customer not found');
        await recordChange(request, id, note, 'customer');
        return noteView(tenantId, await findCustomerNote(fastify.prisma, tenantId, id));
    });

    fastify.get('/by-conversation/:id/note', async (request) => {
        const { id } = idParam.parse(request.params);
        const { tenantId } = request.user;
        const conversation = await loadConversation(tenantId, id);
        const eligibility = noteEligibility(conversation);
        if (!eligibility.eligible) {
            return { eligible: false, reason: eligibility.reason, customerId: null, note: '', updatedAt: null, updatedBy: null };
        }
        const customer = await findNoteCustomer(fastify.prisma, tenantId, conversation);
        return { eligible: true, ...(await noteView(tenantId, customer)) };
    });

    fastify.put('/by-conversation/:id/note', { config: NOTE_WRITE_LIMIT }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { note } = noteBodySchema.parse(request.body);
        const { tenantId, userId } = request.user;
        const conversation = await loadConversation(tenantId, id);
        if (!noteEligibility(conversation).eligible) throw fastify.httpErrors.conflict(NOT_VERIFIED);

        const customer = await resolveNoteCustomerForWrite(fastify.prisma, tenantId, conversation);
        if (!customer) throw fastify.httpErrors.conflict(NOT_VERIFIED);
        const saved = await saveCustomerNote(fastify.prisma, { tenantId, customerId: customer.id, note, userId });
        if (!saved) throw fastify.httpErrors.notFound('Customer not found');
        await recordChange(request, customer.id, note, 'conversation');
        return { eligible: true, ...(await noteView(tenantId, await findCustomerNote(fastify.prisma, tenantId, customer.id))) };
    });
};

export default customerNotesRoutes;
