import { describe, expect, it } from 'vitest';
import { assertAdminSecretDistinct } from './index.js';

describe('assertAdminSecretDistinct', () => {
    it('throws when JWT_SECRET and ADMIN_JWT_SECRET are the same value', () => {
        const same = 'x'.repeat(40);
        expect(() => assertAdminSecretDistinct({ JWT_SECRET: same, ADMIN_JWT_SECRET: same })).toThrow(/ADMIN_JWT_SECRET.*JWT_SECRET/);
    });
    it('passes when they differ', () => {
        expect(() => assertAdminSecretDistinct({ JWT_SECRET: 'a'.repeat(40), ADMIN_JWT_SECRET: 'b'.repeat(40) })).not.toThrow();
    });
    it('the process config itself booted with distinct secrets', async () => {
        const { config } = await import('./index.js');
        expect(config.adminJwtSecret).not.toBe(config.jwtSecret);
    });
});
