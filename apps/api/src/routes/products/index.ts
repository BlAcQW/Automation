import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// Validation schemas
const createProductSchema = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    price: z.number().positive(),
    stock: z.number().int().min(0).default(0),
    imageUrl: z.string().url().optional(),
    category: z.string().optional(),
});

const updateProductSchema = createProductSchema.partial();

const productsRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /products - List all products
    fastify.get('/', async (request) => {
        const query = z.object({
            category: z.string().optional(),
            active: z.enum(['true', 'false']).optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
        }).parse(request.query);

        const where: any = { tenantId: request.user.tenantId };

        if (query.active !== undefined) {
            where.isActive = query.active === 'true';
        }
        if (query.category) {
            where.category = query.category;
        }

        const skip = (query.page - 1) * query.limit;

        const [products, total] = await Promise.all([
            fastify.prisma.product.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
            }),
            fastify.prisma.product.count({ where }),
        ]);

        return {
            data: products,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /products/active - List active products only
    fastify.get('/active', async (request) => {
        const products = await fastify.prisma.product.findMany({
            where: {
                tenantId: request.user.tenantId,
                isActive: true,
            },
            orderBy: { name: 'asc' },
        });

        return { data: products };
    });

    // GET /products/categories - List unique categories
    fastify.get('/categories', async (request) => {
        const products = await fastify.prisma.product.findMany({
            where: { tenantId: request.user.tenantId },
            select: { category: true },
            distinct: ['category'],
        });

        const categories = products
            .map((p: { category: string | null }) => p.category)
            .filter((c: string | null): c is string => c !== null);

        return { data: categories };
    });

    // GET /products/:id - Get single product
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const product = await fastify.prisma.product.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!product) {
            throw fastify.httpErrors.notFound('Product not found');
        }

        return product;
    });

    // POST /products - Create new product
    fastify.post('/', async (request) => {
        const body = createProductSchema.parse(request.body);

        const product = await fastify.prisma.product.create({
            data: {
                tenantId: request.user.tenantId,
                name: body.name,
                description: body.description,
                price: body.price,
                stock: body.stock,
                imageUrl: body.imageUrl,
                category: body.category,
            },
        });

        return product;
    });

    // PATCH /products/:id - Update product
    fastify.patch('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const body = updateProductSchema.parse(request.body);

        const existing = await fastify.prisma.product.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Product not found');
        }

        const product = await fastify.prisma.product.update({
            where: { id },
            data: body,
        });

        return product;
    });

    // PATCH /products/:id/toggle - Toggle active status
    fastify.patch('/:id/toggle', async (request) => {
        const { id } = request.params as { id: string };

        const existing = await fastify.prisma.product.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Product not found');
        }

        const product = await fastify.prisma.product.update({
            where: { id },
            data: { isActive: !existing.isActive },
        });

        return product;
    });

    // PATCH /products/:id/stock - Update stock
    fastify.patch('/:id/stock', async (request) => {
        const { id } = request.params as { id: string };
        const body = z.object({
            stock: z.number().int().min(0),
        }).parse(request.body);

        const existing = await fastify.prisma.product.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Product not found');
        }

        const product = await fastify.prisma.product.update({
            where: { id },
            data: { stock: body.stock },
        });

        return product;
    });

    // DELETE /products/:id - Delete product
    fastify.delete('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const existing = await fastify.prisma.product.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Product not found');
        }

        await fastify.prisma.product.delete({ where: { id } });

        return { success: true };
    });
};

export default productsRoutes;
