import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { maskHandle, maskPhone } from '../../services/contact-privacy.js';
import { resolveMaskPolicy } from '../../services/contact-privacy-policy.js';
import { normalizeCustomerPhone } from '../../services/customer-phone.js';

const customersRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /customers - List aggregated customers
    fastify.get('/', async (request) => {
        const { tenantId } = request.user;
        const query = z.object({
            search: z.string().optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
        }).parse(request.query);

        const skip = (query.page - 1) * query.limit;

        // 1. Get base conversations (represents customers)
        // If searching, filter by name/phone
        // Masking is decided before the query, because it also narrows what
        // may be searched.
        const mask = await resolveMaskPolicy(fastify.prisma, tenantId, request.user.role, !!request.user.support);

        const where: any = { tenantId };
        if (query.search) {
            // Phone search is withheld from masked viewers: being able to ask
            // "which customers contain 0241?" and watch the result count is a
            // digit-at-a-time way back to the number the mask hides. That
            // covers the customer record's phone as much as the conversation's.
            where.OR = mask
                ? [
                    { customerName: { contains: query.search, mode: 'insensitive' } },
                    { customer: { name: { contains: query.search, mode: 'insensitive' } } },
                ]
                : [
                    { customerName: { contains: query.search, mode: 'insensitive' } },
                    { customerPhone: { contains: query.search } },
                    { customer: { name: { contains: query.search, mode: 'insensitive' } } },
                    { customer: { phone: { contains: query.search } } },
                ];
        }

        const [conversations, total] = await Promise.all([
            fastify.prisma.conversation.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { updatedAt: 'desc' },
                select: {
                    id: true, // real conversation id — the reveal endpoint resolves on this
                    customerId: true,
                    customerPhone: true,
                    customerHandle: true,
                    channel: true,
                    customerName: true,
                    updatedAt: true, // Last active
                },
            }),
            fastify.prisma.conversation.count({ where }),
        ]);

        if (conversations.length === 0) {
            return {
                data: [],
                pagination: {
                    page: query.page,
                    limit: query.limit,
                    total,
                    totalPages: 0,
                },
            };
        }

        // 2. Resolve each conversation to its Customer record: by the link when
        // there is one, else by phone (a record may exist from a booking before
        // the conversation was linked). Instagram and Messenger conversations
        // have no phone, so they only match through a link.
        const phoneForms = (phone: string | null): string[] => {
            if (!phone) return [];
            const normalised = normalizeCustomerPhone(phone, null);
            return normalised && normalised !== phone ? [phone, normalised] : [phone];
        };
        const phones = [...new Set(conversations.flatMap((c) => phoneForms(c.customerPhone)))];
        const linkedIds = [...new Set(conversations.map((c) => c.customerId).filter((id): id is string => !!id))];

        const customerLookup = [
            ...(linkedIds.length ? [{ id: { in: linkedIds } }] : []),
            ...(phones.length ? [{ phone: { in: phones } }] : []),
        ];
        const records = customerLookup.length
            ? await fastify.prisma.customer.findMany({
                where: { tenantId, OR: customerLookup },
                select: { id: true, phone: true, name: true },
            })
            : [];
        const recordById = new Map(records.map((r) => [r.id, r]));
        const recordByPhone = new Map(records.map((r) => [r.phone, r]));
        const recordFor = (c: (typeof conversations)[number]) =>
            (c.customerId ? recordById.get(c.customerId) : undefined) ??
            phoneForms(c.customerPhone).map((p) => recordByPhone.get(p)).find(Boolean);

        // 3. Counts: rows linked to the record, plus rows that predate linking
        // (customerId null) matched by phone. The null filter is what stops a
        // linked row being counted by both routes.
        const recordIds = records.map((r) => r.id);
        const byRecord = recordIds.length ? { tenantId, customerId: { in: recordIds } } : null;
        const byPhone = phones.length ? { tenantId, customerId: null, customerPhone: { in: phones } } : null;

        const [ordersByRecord, ordersByPhone, bookingsByRecord, bookingsByPhone] = await Promise.all([
            byRecord
                ? fastify.prisma.order.groupBy({ by: ['customerId'], where: byRecord, _count: true, _sum: { totalAmount: true } })
                : [],
            byPhone
                ? fastify.prisma.order.groupBy({ by: ['customerPhone'], where: byPhone, _count: true, _sum: { totalAmount: true } })
                : [],
            byRecord ? fastify.prisma.booking.groupBy({ by: ['customerId'], where: byRecord, _count: true }) : [],
            byPhone ? fastify.prisma.booking.groupBy({ by: ['customerPhone'], where: byPhone, _count: true }) : [],
        ]);

        const countFor = (
            linked: Array<{ customerId: string | null; _count: number }>,
            legacy: Array<{ customerPhone: string; _count: number }>,
            recordId: string | undefined,
            phone: string | null,
        ): number => {
            const forms = new Set(phoneForms(phone));
            const fromLink = recordId ? linked.find((g) => g.customerId === recordId)?._count ?? 0 : 0;
            const fromPhone = legacy.filter((g) => forms.has(g.customerPhone)).reduce((n, g) => n + g._count, 0);
            return fromLink + fromPhone;
        };
        const spentFor = (recordId: string | undefined, phone: string | null): number => {
            const forms = new Set(phoneForms(phone));
            const fromLink = recordId ? ordersByRecord.find((g: any) => g.customerId === recordId)?._sum.totalAmount : 0;
            const fromPhone = ordersByPhone
                .filter((g: any) => forms.has(g.customerPhone))
                .reduce((n: number, g: any) => n + Number(g._sum.totalAmount || 0), 0);
            return Number(fromLink || 0) + fromPhone;
        };

        // 4. Merge data
        const customers = conversations.map(c => {
            const phone = c.customerPhone;
            const record = recordFor(c);

            return {
                // The id is only a list key on the client. Handing over the raw
                // phone (or any hash of it: the visible prefix and last four
                // digits leave few enough candidates to brute-force) would undo
                // the masking, so a masked viewer gets the conversation id.
                id: mask ? c.id : (phone ?? c.id),
                // Separate from `id`, which is only a list key: reveal has to
                // address a real record.
                conversationId: c.id,
                customerId: record?.id ?? null,
                name: record?.name || c.customerName || 'Unknown',
                phone: phone ? (mask ? maskPhone(phone) : phone) : null,
                handle: c.customerHandle ? (mask ? maskHandle(c.customerHandle) : c.customerHandle) : null,
                channel: c.channel,
                contactMasked: mask,
                lastActive: c.updatedAt,
                totalOrders: countFor(ordersByRecord as any, ordersByPhone as any, record?.id, phone),
                totalSpent: spentFor(record?.id, phone),
                totalBookings: countFor(bookingsByRecord as any, bookingsByPhone as any, record?.id, phone),
            };
        });

        return {
            data: customers,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /customers/stats
    fastify.get('/stats', async (request) => {
        const { tenantId } = request.user;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [conversationCount, customerCount, activeThisMonth, totalOrders] = await Promise.all([
            fastify.prisma.conversation.count({ where: { tenantId } }),
            fastify.prisma.customer.count({ where: { tenantId } }),
            fastify.prisma.conversation.count({
                where: {
                    tenantId,
                    updatedAt: { gte: startOfMonth },
                },
            }),
            fastify.prisma.order.count({ where: { tenantId } }),
        ]);

        return {
            // Customer records are authoritative once they exist; a tenant whose
            // history predates linking still has its conversations to count.
            totalCustomers: Math.max(conversationCount, customerCount),
            activeThisMonth,
            totalOrders,
        };
    });
};

export default customersRoutes;
