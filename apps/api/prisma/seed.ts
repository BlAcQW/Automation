import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Create platform admin
    const adminPassword = await bcrypt.hash('admin123', 12);
    const admin = await prisma.admin.upsert({
        where: { email: 'admin@bookingflow.com' },
        update: {},
        create: {
            email: 'admin@bookingflow.com',
            passwordHash: adminPassword,
            name: 'Platform Admin',
            isSuperAdmin: true,
        },
    });
    console.log('✅ Created platform admin:', admin.email);

    // ========================================
    // Service Business Demo (Salon)
    // ========================================
    const serviceTenant = await prisma.tenant.upsert({
        where: { id: 'demo-tenant-service' },
        update: {},
        create: {
            id: 'demo-tenant-service',
            name: 'Demo Salon',
            businessType: 'SERVICE',
            timezone: 'America/New_York',
        },
    });
    console.log('✅ Created service tenant:', serviceTenant.name);

    // Create demo user (owner) for service business
    const userPassword = await bcrypt.hash('demo123', 12);
    const serviceUser = await prisma.user.upsert({
        where: { email: 'salon@example.com' },
        update: {},
        create: {
            email: 'salon@example.com',
            passwordHash: userPassword,
            name: 'Salon Owner',
            role: 'OWNER',
            tenantId: serviceTenant.id,
        },
    });
    console.log('✅ Created service user:', serviceUser.email);

    // Create working hours (Mon-Fri 9-17) for service business
    for (let day = 1; day <= 5; day++) {
        await prisma.workingHours.upsert({
            where: {
                tenantId_dayOfWeek: { tenantId: serviceTenant.id, dayOfWeek: day },
            },
            update: {},
            create: {
                tenantId: serviceTenant.id,
                dayOfWeek: day,
                startTime: '09:00',
                endTime: '17:00',
            },
        });
    }
    console.log('✅ Created working hours for salon (Mon-Fri 9:00-17:00)');

    // Create demo services
    const services = [
        { name: 'Haircut', price: 35, duration: 30, category: 'Hair' },
        { name: 'Hair Coloring', price: 80, duration: 90, category: 'Hair' },
        { name: 'Beard Trim', price: 20, duration: 15, category: 'Grooming' },
        { name: 'Manicure', price: 25, duration: 30, category: 'Nails' },
        { name: 'Pedicure', price: 35, duration: 45, category: 'Nails' },
        { name: 'Facial Treatment', price: 60, duration: 60, category: 'Skincare' },
    ];

    for (const service of services) {
        await prisma.service.upsert({
            where: {
                id: `demo-service-${service.name.toLowerCase().replace(/\s/g, '-')}`
            },
            update: {},
            create: {
                id: `demo-service-${service.name.toLowerCase().replace(/\s/g, '-')}`,
                tenantId: serviceTenant.id,
                name: service.name,
                price: service.price,
                durationMinutes: service.duration,
                category: service.category,
            },
        });
    }
    console.log('✅ Created', services.length, 'demo services');

    // ========================================
    // Product Business Demo (Store)
    // ========================================
    const productTenant = await prisma.tenant.upsert({
        where: { id: 'demo-tenant-product' },
        update: {},
        create: {
            id: 'demo-tenant-product',
            name: 'Demo Store',
            businessType: 'PRODUCT',
            timezone: 'America/New_York',
        },
    });
    console.log('✅ Created product tenant:', productTenant.name);

    // Create demo user (owner) for product business
    const productUser = await prisma.user.upsert({
        where: { email: 'store@example.com' },
        update: {},
        create: {
            email: 'store@example.com',
            passwordHash: userPassword,
            name: 'Store Owner',
            role: 'OWNER',
            tenantId: productTenant.id,
        },
    });
    console.log('✅ Created product user:', productUser.email);

    // Create demo products
    const products = [
        { name: 'Organic Shampoo', price: 24.99, stock: 50, category: 'Hair Care' },
        { name: 'Deep Conditioner', price: 19.99, stock: 40, category: 'Hair Care' },
        { name: 'Styling Gel', price: 12.99, stock: 75, category: 'Hair Care' },
        { name: 'Beard Oil', price: 18.99, stock: 30, category: 'Grooming' },
        { name: 'Face Moisturizer', price: 29.99, stock: 25, category: 'Skincare' },
        { name: 'Nail Polish Set', price: 15.99, stock: 60, category: 'Nails' },
    ];

    for (const product of products) {
        await prisma.product.upsert({
            where: {
                id: `demo-product-${product.name.toLowerCase().replace(/\s/g, '-')}`
            },
            update: {},
            create: {
                id: `demo-product-${product.name.toLowerCase().replace(/\s/g, '-')}`,
                tenantId: productTenant.id,
                name: product.name,
                price: product.price,
                stock: product.stock,
                category: product.category,
                isActive: true,
            },
        });
    }
    console.log('✅ Created', products.length, 'demo products');

    console.log('\n📋 Demo Credentials:');
    console.log('  Platform Admin: admin@bookingflow.com / admin123');
    console.log('  Service Business (Salon): salon@example.com / demo123');
    console.log('  Product Business (Store): store@example.com / demo123');
    console.log('\n🎉 Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

