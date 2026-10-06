import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
    ApiError,
    V1_ROUTE_CONFIG,
    attributesSchema,
    e164,
    idParam,
    pageArgs,
    paginationQuery,
    publishBestEffort,
    requireApiKey,
    serializeCustomer,
    toPage,
} from './shared.js';

const idParams = z.object({ id: idParam });
const name = z.string().trim().min(1).max(120);
const email = z.string().trim().max(254).email();

const listQuery = paginationQuery.extend({ phone: e164.optional() });

const createBody = z
    .object({ phone: e164, name: name.optional(), email: email.optional(), attributes: attributesSchema.optional() })
    .strict();

// phone is the customer's identity (unique per tenant) and is deliberately not patchable.
const patchBody = z
    .object({ name: name.nullable(), email: email.nullable(), attributes: attributesSchema.nullable() })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const customerRoutes: FastifyPluginAsync = async (fastify) => {
    const cfg = { config: V1_ROUTE_CONFIG };
    const read = { ...cfg, preHandler: fastify.authenticateApiKey(['customers:read']) };
    const write = { ...cfg, preHandler: fastify.authenticateApiKey(['customers:write']) };

    // GET /v1/customers
    fastify.get('/customers', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const q = listQuery.parse(request.query);
        const rows = await fastify.prisma.customer.findMany({
            where: { tenantId, ...(q.phone ? { phone: q.phone } : {}) },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...pageArgs(q),
        });
        const { items, pagination } = toPage(rows, q.limit);
        return { data: items.map(serializeCustomer), pagination };
    });

    // GET /v1/customers/:id
    fastify.get('/customers/:id', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const customer = await fastify.prisma.customer.findFirst({ where: { id, tenantId } });
        if (!customer) throw new ApiError(404, 'not_found', 'Customer not found');
        return { data: serializeCustomer(customer) };
    });

    // POST /v1/customers
    fastify.post('/customers', write, async (request, reply) => {
        const { tenantId } = requireApiKey(request);
        const body = createBody.parse(request.body);

        const existing = await fastify.prisma.customer.findFirst({ where: { tenantId, phone: body.phone } });
        if (existing) throw new ApiError(409, 'conflict', 'A customer with this phone number already exists.');

        const customer = await fastify.prisma.customer.create({
            data: {
                tenantId,
                phone: body.phone,
                ...(body.name !== undefined ? { name: body.name } : {}),
                ...(body.email !== undefined ? { email: body.email } : {}),
                ...(body.attributes !== undefined ? { attributes: body.attributes as Prisma.InputJsonObject } : {}),
            },
        });
        await publishBestEffort(fastify.prisma, tenantId, 'customer.created', { customerId: customer.id });
        reply.code(201);
        return { data: serializeCustomer(customer) };
    });

    // PATCH /v1/customers/:id  (attributes are REPLACED as a whole; null clears)
    fastify.patch('/customers/:id', write, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const body = patchBody.parse(request.body);

        const data: Prisma.CustomerUpdateManyMutationInput = {};
        const changed: string[] = [];
        for (const field of Object.keys(body) as Array<keyof typeof body>) {
            changed.push(field);
            if (field === 'attributes') {
                data.attributes = body.attributes === null ? Prisma.JsonNull : (body.attributes as Prisma.InputJsonObject);
            } else {
                (data as Record<string, unknown>)[field] = body[field];
            }
        }

        const { count } = await fastify.prisma.customer.updateMany({ where: { id, tenantId }, data });
        if (count === 0) throw new ApiError(404, 'not_found', 'Customer not found');

        const customer = await fastify.prisma.customer.findFirst({ where: { id, tenantId } });
        if (!customer) throw new ApiError(404, 'not_found', 'Customer not found');
        await publishBestEffort(fastify.prisma, tenantId, 'customer.updated', { customerId: id, changed });
        return { data: serializeCustomer(customer) };
    });
};

export default customerRoutes;
