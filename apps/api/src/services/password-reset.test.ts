import { describe, expect, it } from 'vitest';
import {
    RESET_TOKEN_TTL_SECONDS,
    createResetToken,
    parseResetToken,
    passwordResetEmail,
    verifyResetToken,
} from './password-reset.js';

const SECRET = 'test-jwt-secret';
const user = { id: 'user_1', passwordHash: '$2a$12$oldhash' };

describe('password reset tokens', () => {
    it('round-trips for the right user with the right hash', () => {
        const token = createResetToken(user, SECRET);
        expect(parseResetToken(token)?.userId).toBe('user_1');
        expect(verifyResetToken(token, user, SECRET)).toBe(true);
    });

    it('stops verifying once the password has changed (single use)', () => {
        const token = createResetToken(user, SECRET);
        expect(verifyResetToken(token, { ...user, passwordHash: '$2a$12$newhash' }, SECRET)).toBe(false);
    });

    it('expires after the TTL', () => {
        const issued = Date.now();
        const token = createResetToken(user, SECRET, issued);
        expect(verifyResetToken(token, user, SECRET, issued + (RESET_TOKEN_TTL_SECONDS - 1) * 1000)).toBe(true);
        expect(verifyResetToken(token, user, SECRET, issued + (RESET_TOKEN_TTL_SECONDS + 1) * 1000)).toBe(false);
    });

    it('rejects a token for another user, a wrong secret, or a tampered payload', () => {
        const token = createResetToken(user, SECRET);
        expect(verifyResetToken(token, { id: 'user_2', passwordHash: user.passwordHash }, SECRET)).toBe(false);
        expect(verifyResetToken(token, user, 'other-secret')).toBe(false);

        const [, sig] = token.split('.');
        const forged = Buffer.from(JSON.stringify({ sub: 'user_1', exp: 4102444800 })).toString('base64url');
        expect(verifyResetToken(`${forged}.${sig}`, user, SECRET)).toBe(false);
    });

    it('parse never throws on garbage', () => {
        expect(parseResetToken('')).toBeNull();
        expect(parseResetToken('not-base64.at-all')).toBeNull();
        expect(parseResetToken(Buffer.from('{"sub":1}').toString('base64url') + '.x')).toBeNull();
    });

    it('email escapes the name and carries the link in text and html', () => {
        const mail = passwordResetEmail({ name: '<b>Ama</b> Mensah', link: 'https://x.test/reset?token=abc' });
        expect(mail.text).toContain('https://x.test/reset?token=abc');
        expect(mail.html).toContain('https://x.test/reset?token=abc');
        expect(mail.html).not.toContain('<b>Ama</b>');
        expect(mail.text.startsWith('Hi <b>Ama</b>,')).toBe(true);
    });
});
