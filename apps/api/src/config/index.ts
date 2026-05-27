import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Resolve the .env path defensively. Under `tsx watch`, __dirname is the
// source file's directory (.../apps/api/src/config). Under compiled output
// it's the dist directory. Under monorepo cwd it might be the repo root.
// Try every reasonable spot, take the first that exists, log the result.
function loadEnvFile(): void {
    if (process.env.NODE_ENV === 'test') return; // tests inject their own defaults

    const explicit = process.env.DOTENV_CONFIG_PATH;
    const candidates = [
        explicit,
        path.resolve(__dirname, '../../.env'),         // apps/api/.env
        path.resolve(__dirname, '../../../.env'),      // repo root .env (from src/config)
        path.resolve(__dirname, '../../../../.env'),   // repo root .env (from dist/src/config)
        path.resolve(process.cwd(), '.env'),           // wherever the process was started
        path.resolve(process.cwd(), '../../.env'),     // repo root when cwd = apps/api
    ].filter((p): p is string => !!p);

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        const result = dotenv.config({ path: candidate });
        if (!result.error) {
            // eslint-disable-next-line no-console
            console.log(`[config] loaded env from ${candidate}`);
            return;
        }
    }

    // eslint-disable-next-line no-console
    console.warn(
        '[config] could NOT find a readable .env file. Looked at:\n' +
        candidates.map((c) => `  - ${c}`).join('\n'),
    );
}

loadEnvFile();

const envSchema = z.object({
    // Server
    API_PORT: z.string().default('3001'),
    API_HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Redis (optional)
    REDIS_URL: z.string().optional(),

    // JWT
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 characters'),

    // Encryption (used by services/crypto.ts + OAuth state signing)
    ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

    // WhatsApp Cloud API
    WHATSAPP_APP_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().min(1, 'WHATSAPP_APP_SECRET is required for webhook signature verification'),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is required'),
    WHATSAPP_REDIRECT_URI: z.string().optional(),

    // Paystack (per-tenant keys; the platform-level only optionally overrides
    // where Paystack redirects the customer after payment).
    PAYSTACK_CALLBACK_URL: z.string().optional(),

    // Phase 4b — Bookly platform Paystack (separate from per-tenant keys).
    // Used by /billing routes to charge tenants for the SaaS subscription.
    BOOKINGFLOW_PAYSTACK_SECRET_KEY: z.string().optional(),
    BOOKINGFLOW_PAYSTACK_PUBLIC_KEY: z.string().optional(),
    PAYSTACK_PLAN_STARTER_CODE: z.string().optional(),
    PAYSTACK_PLAN_PRO_CODE: z.string().optional(),

    // Phase 5a — Platform SMTP fallback. Either naming convention works:
    //   SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_FROM_NAME
    //   BOOKINGFLOW_GMAIL_USER / BOOKINGFLOW_GMAIL_APP_PASSWORD / BOOKINGFLOW_GMAIL_FROM_NAME
    // The SMTP_* names take precedence when both are set.
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_SECURE: z.string().optional(),
    SMTP_FROM_NAME: z.string().optional(),
    BOOKINGFLOW_GMAIL_USER: z.string().optional(),
    BOOKINGFLOW_GMAIL_APP_PASSWORD: z.string().optional(),
    BOOKINGFLOW_GMAIL_FROM_NAME: z.string().optional(),

    // Google Calendar
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),

    // Outlook (scaffolded)
    OUTLOOK_CLIENT_ID: z.string().optional(),
    OUTLOOK_CLIENT_SECRET: z.string().optional(),
    OUTLOOK_REDIRECT_URI: z.string().optional(),

    // Frontend
    FRONTEND_URL: z.string().optional(),
    NEXT_PUBLIC_API_URL: z.string().optional(),

    // Observability (optional)
    SENTRY_DSN: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),

    // Feature flags. PRODUCT mode is parked until the SERVICE side is proven
    // in production — flip this back to "true" to re-enable product/order
    // signup and the PRODUCT-side dashboard. The frontend reads a sibling
    // NEXT_PUBLIC_ENABLE_PRODUCT_MODE for its own gating.
    ENABLE_PRODUCT_MODE: z.string().optional(),
});

// In test mode, fall back to deterministic dummy values so unit tests that
// merely import this module (transitively, via crypto / config) don't have
// to set up every secret. Real env vars still take precedence if provided.
if (process.env.NODE_ENV === 'test') {
    const testDefaults: Record<string, string> = {
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        JWT_SECRET: 'test-jwt-secret-test-jwt-secret-test',
        JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret',
        ADMIN_JWT_SECRET: 'test-admin-secret-test-admin-secret',
        ENCRYPTION_KEY: 'test-encryption-key-test-encryption-key',
        WHATSAPP_APP_ID: 'test-app-id',
        WHATSAPP_APP_SECRET: 'test-app-secret',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
        WHATSAPP_REDIRECT_URI: 'http://localhost:3000/whatsapp',
    };
    for (const [k, v] of Object.entries(testDefaults)) {
        if (!process.env[k]) process.env[k] = v;
    }
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
    // Fail fast at boot — never let the app start with broken secrets
    throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
    port: parseInt(env.API_PORT, 10),
    host: env.API_HOST,
    nodeEnv: env.NODE_ENV,

    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,

    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    adminJwtSecret: env.ADMIN_JWT_SECRET,
    jwtExpiresIn: '15m',
    jwtRefreshExpiresIn: '7d',

    encryptionKey: env.ENCRYPTION_KEY,

    whatsapp: {
        appId: env.WHATSAPP_APP_ID,
        appSecret: env.WHATSAPP_APP_SECRET,
        webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        redirectUri: env.WHATSAPP_REDIRECT_URI,
    },

    paystack: {
        callbackUrl: env.PAYSTACK_CALLBACK_URL,
    },

    // Phase 4b — Bookly's own Paystack for SaaS billing.
    platformPaystack: {
        secretKey: env.BOOKINGFLOW_PAYSTACK_SECRET_KEY,
        publicKey: env.BOOKINGFLOW_PAYSTACK_PUBLIC_KEY,
        planCodes: {
            starter: env.PAYSTACK_PLAN_STARTER_CODE,
            pro: env.PAYSTACK_PLAN_PRO_CODE,
        },
    },

    // Phase 5a — Platform SMTP for fallback email sends. SMTP_* env vars
    // are read first (standard nodemailer naming); BOOKINGFLOW_GMAIL_* are
    // accepted as aliases for backward compatibility.
    platformGmail: {
        user: env.SMTP_USER || env.BOOKINGFLOW_GMAIL_USER,
        appPassword: env.SMTP_PASS || env.BOOKINGFLOW_GMAIL_APP_PASSWORD,
        fromName: env.SMTP_FROM_NAME || env.BOOKINGFLOW_GMAIL_FROM_NAME || 'Bookly',
        host: env.SMTP_HOST || 'smtp.gmail.com',
        port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : 465,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : true,
    },

    google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: env.GOOGLE_REDIRECT_URI,
    },

    outlook: {
        clientId: env.OUTLOOK_CLIENT_ID,
        clientSecret: env.OUTLOOK_CLIENT_SECRET,
        redirectUri: env.OUTLOOK_REDIRECT_URI,
    },

    frontendUrl: env.FRONTEND_URL || env.NEXT_PUBLIC_API_URL?.replace(/\/api$/, '') || 'http://localhost:3000',

    corsOrigins: [
        env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
        env.NODE_ENV === 'development' ? 'http://localhost:3001' : null,
        env.FRONTEND_URL,
    ].filter((origin): origin is string => Boolean(origin)),

    featureFlags: {
        // PRODUCT mode (signup, product/order/inventory dashboards, product
        // bot flow). Default OFF so the platform launches as service-only.
        // Flip ENABLE_PRODUCT_MODE=true to re-enable.
        productMode: env.ENABLE_PRODUCT_MODE === 'true',
    },
};

export type Config = typeof config;
