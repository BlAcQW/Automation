/**
 * The signed-in user's own account: name and password.
 *
 * These are the routes apps/api registers in src/routes/auth/index.ts. The
 * Settings page used to call PUT /users/me and PUT /users/me/password, which
 * never existed, so every save 404'd. The minimums mirror the API's zod rules
 * so a too-short value gets a clear message instead of a generic 400.
 */

export const PROFILE_PATH = '/auth/profile';
export const CHANGE_PASSWORD_PATH = '/auth/change-password';

export const MIN_NAME_LENGTH = 2;
export const MIN_PASSWORD_LENGTH = 8;

/** The slice of the axios instance these calls need. */
export interface AccountClient {
    patch(url: string, data?: unknown): Promise<unknown>;
    post(url: string, data?: unknown): Promise<unknown>;
}

/** Returns a message to show if the name can't be saved, else null. */
export function nameProblem(name: string): string | null {
    return name.trim().length < MIN_NAME_LENGTH
        ? `Your name needs at least ${MIN_NAME_LENGTH} characters.`
        : null;
}

/** Returns a message to show if the new password is too weak, else null. */
export function newPasswordProblem(password: string): string | null {
    return password.length < MIN_PASSWORD_LENGTH
        ? `Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`
        : null;
}

export async function saveProfileName(client: AccountClient, name: string): Promise<void> {
    const problem = nameProblem(name);
    if (problem) throw new Error(problem);
    await client.patch(PROFILE_PATH, { name: name.trim() });
}

export async function changePassword(
    client: AccountClient,
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    const problem = newPasswordProblem(newPassword);
    if (problem) throw new Error(problem);
    await client.post(CHANGE_PASSWORD_PATH, { currentPassword, newPassword });
}
