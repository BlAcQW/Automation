/**
 * Who may create a new organisation through POST /auth/register.
 *
 * CLOSED by default: self sign-up opens only when the API env has exactly
 * REGISTRATION_OPEN=true (read per request, so a test or an operator flip
 * needs no rebuild; production still needs a restart to pick up new env).
 * While closed, a sign-up must carry a waitlist invite token that is valid
 * (entry INVITED, unused, unexpired) and was issued for the same email.
 *
 * The invite is consumed INSIDE the sign-up transaction with a guarded
 * UPDATE (consumeInvite), so of two sign-ups racing on one invite exactly
 * one wins and the loser's organisation is rolled back.
 *
 * While open, a valid invite is still consumed (the entry becomes JOINED); a
 * stale or mismatched one is ignored rather than blocking an open sign-up.
 *
 * Every refusal is a 403 with a stable `code` the web app branches on.
 */
import { ApiError } from './api-error.js';
import { hashInviteToken, inviteState, type WaitlistDb } from './waitlist.js';

export function isRegistrationOpen(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.REGISTRATION_OPEN?.trim().toLowerCase() === 'true';
}

export type GateCode = 'WAITLIST_ONLY' | 'INVITE_INVALID' | 'INVITE_EXPIRED' | 'INVITE_USED' | 'INVITE_EMAIL_MISMATCH';

const MESSAGES: Record<GateCode, string> = {
    WAITLIST_ONLY: "Bookly is invite-only for now. Join the waitlist and we'll message you when it's your turn.",
    INVITE_INVALID: "This invite link doesn't work. Check you copied all of it, or join the waitlist.",
    INVITE_EXPIRED: 'This invite has expired. Ask us for a new one.',
    INVITE_USED: 'This invite has already been used. Log in instead.',
    INVITE_EMAIL_MISMATCH: 'This invite is for a different email address. Sign up with the email the invite was sent to.',
};

export function gateError(code: GateCode): ApiError {
    return new ApiError(403, code, MESSAGES[code]);
}

export interface GateInvite {
    entryId: string;
    tokenHash: string;
}

/** Longest token we bother hashing; real ones are 43 characters. */
const MAX_TOKEN_LENGTH = 200;

/**
 * Decide before any write. Returns the invite to consume (or null for a
 * plain open sign-up); throws a 403 ApiError when the sign-up is refused.
 */
export async function resolveRegistrationGate(
    db: WaitlistDb,
    args: { open: boolean; inviteToken?: string | null; email: string; now?: Date },
): Promise<GateInvite | null> {
    const now = args.now ?? new Date();
    const token = args.inviteToken?.trim();
    if (!token) {
        if (args.open) return null;
        throw gateError('WAITLIST_ONLY');
    }

    const tokenHash = token.length <= MAX_TOKEN_LENGTH ? hashInviteToken(token) : null;
    const entry = tokenHash ? await db.waitlistEntry.findUnique({ where: { inviteTokenHash: tokenHash } }) : null;
    const state = inviteState(entry, now);
    const refusal: GateCode | null =
        state === 'expired' ? 'INVITE_EXPIRED'
            : state === 'used' ? 'INVITE_USED'
                : state === 'invalid' ? 'INVITE_INVALID'
                    : entry!.email !== args.email.trim().toLowerCase() ? 'INVITE_EMAIL_MISMATCH'
                        : null;

    if (refusal) {
        if (args.open) return null;
        throw gateError(refusal);
    }
    return { entryId: entry!.id, tokenHash: tokenHash! };
}

/**
 * Consume the invite and mark the entry JOINED. Call inside the transaction
 * that creates the organisation: a 0-row update means someone else used it
 * first, and the thrown error rolls the whole sign-up back.
 */
export async function consumeInvite(
    tx: WaitlistDb,
    invite: GateInvite,
    tenantId: string,
    now: Date = new Date(),
): Promise<void> {
    const { count } = await tx.waitlistEntry.updateMany({
        where: {
            id: invite.entryId,
            inviteTokenHash: invite.tokenHash,
            status: 'INVITED',
            inviteUsedAt: null,
            inviteExpiresAt: { gt: now },
        },
        data: { status: 'JOINED', inviteUsedAt: now, joinedTenantId: tenantId },
    });
    if (count !== 1) throw gateError('INVITE_USED');
}
