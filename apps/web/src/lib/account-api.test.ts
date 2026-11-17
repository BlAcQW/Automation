import { describe, expect, it, vi } from 'vitest';
import {
    CHANGE_PASSWORD_PATH,
    PROFILE_PATH,
    changePassword,
    nameProblem,
    newPasswordProblem,
    saveProfileName,
    type AccountClient,
} from './account-api';

function fakeClient(): AccountClient & { patch: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } {
    return {
        patch: vi.fn().mockResolvedValue({ data: { success: true } }),
        post: vi.fn().mockResolvedValue({ data: { success: true } }),
    };
}

describe('account endpoints', () => {
    it('uses the routes apps/api actually registers', () => {
        // PUT /users/me and PUT /users/me/password never existed and 404'd.
        expect(PROFILE_PATH).toBe('/auth/profile');
        expect(CHANGE_PASSWORD_PATH).toBe('/auth/change-password');
    });
});

describe('saveProfileName', () => {
    it('PATCHes only the trimmed name to /auth/profile', async () => {
        const client = fakeClient();

        await saveProfileName(client, '  Ama Mensah  ');

        expect(client.patch).toHaveBeenCalledWith('/auth/profile', { name: 'Ama Mensah' });
        expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a name the API would refuse, without calling it', async () => {
        const client = fakeClient();

        await expect(saveProfileName(client, ' A ')).rejects.toThrow(/at least 2/);
        expect(client.patch).not.toHaveBeenCalled();
    });

    it('passes API failures through to the caller', async () => {
        const client = fakeClient();
        client.patch.mockRejectedValue(new Error('Request failed with status code 500'));

        await expect(saveProfileName(client, 'Ama')).rejects.toThrow('500');
    });
});

describe('nameProblem', () => {
    it('accepts two or more characters after trimming', () => {
        expect(nameProblem('Al')).toBeNull();
        expect(nameProblem('  ')).toMatch(/at least 2/);
        expect(nameProblem('')).toMatch(/at least 2/);
    });
});

describe('changePassword', () => {
    it('POSTs both passwords to /auth/change-password', async () => {
        const client = fakeClient();

        await changePassword(client, 'old-secret', 'new-secret-1');

        expect(client.post).toHaveBeenCalledWith('/auth/change-password', {
            currentPassword: 'old-secret',
            newPassword: 'new-secret-1',
        });
        expect(client.patch).not.toHaveBeenCalled();
    });

    it('rejects a new password shorter than 8 characters, without calling the API', async () => {
        const client = fakeClient();

        await expect(changePassword(client, 'old-secret', 'short')).rejects.toThrow(/at least 8/);
        expect(client.post).not.toHaveBeenCalled();
    });
});

describe('newPasswordProblem', () => {
    it('requires at least 8 characters', () => {
        expect(newPasswordProblem('1234567')).toMatch(/at least 8/);
        expect(newPasswordProblem('12345678')).toBeNull();
    });
});
