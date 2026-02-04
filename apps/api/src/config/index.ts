import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from root .env
// Load environment variables - try local .env first, then root .env
import fs from 'fs';
dotenv.config({ path: path.join(__dirname, '../../.env') }); // Try local apps/api/.env
if (!process.env.DATABASE_URL) {
    dotenv.config({ path: path.join(__dirname, '../../../.env') }); // Fallback to root .env
}

export const config = {
    // Server
    port: parseInt(process.env.API_PORT || '3001', 10),
    host: process.env.API_HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    databaseUrl: process.env.DATABASE_URL!,

    // Redis (optional - for job queues)
    redisUrl: process.env.REDIS_URL || undefined,

    // JWT
    jwtSecret: process.env.JWT_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
    jwtExpiresIn: '15m',
    jwtRefreshExpiresIn: '7d',

    // Encryption
    encryptionKey: process.env.ENCRYPTION_KEY!,

    // WhatsApp
    whatsapp: {
        appId: process.env.WHATSAPP_APP_ID,
        appSecret: process.env.WHATSAPP_APP_SECRET,
        webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    },

    // Google Calendar
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },

    // Outlook Calendar
    outlook: {
        clientId: process.env.OUTLOOK_CLIENT_ID,
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
        redirectUri: process.env.OUTLOOK_REDIRECT_URI,
    },

    // Frontend
    frontendUrl: process.env.NEXT_PUBLIC_API_URL?.replace(/\/api$/, '') || 'http://localhost:3000',

    // CORS
    corsOrigins: [
        'http://localhost:3000',
        'http://localhost:3001',
        process.env.FRONTEND_URL,
    ].filter(Boolean) as string[],
};

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.warn(`Warning: ${envVar} is not set`);
    }
}

export type Config = typeof config;
