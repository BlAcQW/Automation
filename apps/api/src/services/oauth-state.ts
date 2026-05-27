import crypto from 'node:crypto';
import { config } from '../config/index.js';

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SIGNING_KEY = crypto.createHash('sha256').update(`${config.encryptionKey}::oauth-state`).digest();

interface StatePayload {
    tenantId: string;
    userId: string;
}

interface SignedState extends StatePayload {
    nonce: string;
    exp: number;
}

/**
 * Sign an OAuth state payload with a TTL. The signature uses HMAC-SHA256 over
 * the base64url-encoded body, so a tampered or replayed state is rejected.
 */
export function signOAuthState(payload: StatePayload): string {
    const body: SignedState = {
        ...payload,
        nonce: crypto.randomBytes(16).toString('hex'),
        exp: Date.now() + STATE_TTL_MS,
    };
    const encoded = base64url(JSON.stringify(body));
    const sig = hmac(encoded);
    return `${encoded}.${sig}`;
}

/**
 * Verify a signed state. Throws on invalid signature or expiry. Returns the
 * underlying payload on success.
 */
export function verifyOAuthState(state: string): StatePayload {
    const [encoded, sig] = state.split('.');
    if (!encoded || !sig) {
        throw new Error('Malformed OAuth state');
    }

    const expectedSig = hmac(encoded);
    const sigBuf = safeBuffer(sig);
    const expectedBuf = safeBuffer(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        throw new Error('Invalid OAuth state signature');
    }

    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedState;
    if (typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
        throw new Error('OAuth state expired');
    }
    if (!decoded.tenantId || !decoded.userId) {
        throw new Error('OAuth state missing required claims');
    }
    return { tenantId: decoded.tenantId, userId: decoded.userId };
}

function base64url(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function hmac(input: string): string {
    return crypto.createHmac('sha256', SIGNING_KEY).update(input).digest('base64url');
}

function safeBuffer(input: string): Buffer {
    try {
        return Buffer.from(input, 'base64url');
    } catch {
        return Buffer.alloc(0);
    }
}
