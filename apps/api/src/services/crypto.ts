/**
 * Encryption utilities for sensitive data (WhatsApp access tokens, etc.)
 * Uses AES-256-GCM with random IV for authenticated encryption.
 */

import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte key from the ENCRYPTION_KEY env var.
 * Uses SHA-256 so any-length passphrase works consistently.
 */
function getKey(): Buffer {
    const key = config.encryptionKey;
    if (!key) {
        throw new Error('ENCRYPTION_KEY is not set in environment variables');
    }
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext string.
 * Returns a hex string in the format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with encrypt().
 * Expects the iv:authTag:ciphertext hex format.
 */
export function decrypt(encryptedText: string): string {
    const key = getKey();
    const parts = encryptedText.split(':');

    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
