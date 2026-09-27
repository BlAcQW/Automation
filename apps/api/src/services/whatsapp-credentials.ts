/**
 * Phase 6 — the single place that answers "which WhatsApp credentials does
 * this tenant send with?".
 *
 * Before hosted numbers existed, every call site read
 * `tenant.whatsappAccessToken`, null-checked it and decrypted it inline —
 * twelve copies of the same three lines. A hosted number has NO per-tenant
 * token (it lives on Bookly's WABA and uses the platform token), so each of
 * those copies would have silently treated hosted tenants as disconnected.
 * Centralising the decision here is what makes the hosted path work at all.
 *
 * The decision is split from the I/O deliberately: `selectCredentialSource` is
 * pure and unit-tested, `getWhatsappCredentials` does the database read and
 * the decrypt.
 */

import type { PrismaClient } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { config } from '../config/index.js';
import { decrypt } from './crypto.js';

export type AnyPrismaClient = PrismaClient | ExtendedPrismaClient;

/** The tenant columns the decision depends on. */
export interface TenantWhatsappFields {
    whatsappPhoneNumberId: string | null;
    whatsappAccessToken: string | null;
    whatsappHosted: boolean;
    whatsappNumberStatus: string | null;
}

export type CredentialSource =
    | { kind: 'hosted'; phoneNumberId: string }
    | { kind: 'own'; phoneNumberId: string; encryptedToken: string }
    | null;

export interface WhatsappCredentials {
    phoneNumberId: string;
    accessToken: string;
    /** TRUE when Meta bills Bookly for this number rather than the tenant. */
    hosted: boolean;
}

/** Columns to select when loading a tenant for credential resolution. */
export const WHATSAPP_CREDENTIAL_SELECT = {
    whatsappPhoneNumberId: true,
    whatsappAccessToken: true,
    whatsappHosted: true,
    whatsappNumberStatus: true,
} as const;

/**
 * Decide which token a tenant sends with, or null when they cannot send.
 *
 * A hosted number only counts as live once it is REGISTERED: between creation
 * and OTP verification the number exists on our WABA but Meta rejects sends on
 * it with (#133010) "Account not registered".
 */
export function selectCredentialSource(
    tenant: TenantWhatsappFields | null | undefined,
): CredentialSource {
    if (!tenant?.whatsappPhoneNumberId) return null;

    if (tenant.whatsappHosted) {
        if (tenant.whatsappNumberStatus !== 'REGISTERED') return null;
        return { kind: 'hosted', phoneNumberId: tenant.whatsappPhoneNumberId };
    }

    if (!tenant.whatsappAccessToken) return null;
    return {
        kind: 'own',
        phoneNumberId: tenant.whatsappPhoneNumberId,
        encryptedToken: tenant.whatsappAccessToken,
    };
}

/** Resolve a source into a usable token, or null if the platform isn't set up. */
export function resolveCredentials(source: CredentialSource): WhatsappCredentials | null {
    if (!source) return null;

    if (source.kind === 'hosted') {
        const token = config.platformWhatsapp.accessToken;
        if (!token) return null;
        return { phoneNumberId: source.phoneNumberId, accessToken: token, hosted: true };
    }

    return {
        phoneNumberId: source.phoneNumberId,
        accessToken: decrypt(source.encryptedToken),
        hosted: false,
    };
}

/**
 * Load a tenant and resolve its sending credentials. Returns null when the
 * tenant cannot send — not connected, mid-onboarding, or (for hosted numbers)
 * the platform WABA isn't configured.
 */
export async function getWhatsappCredentials(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<WhatsappCredentials | null> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: WHATSAPP_CREDENTIAL_SELECT,
    });
    if (!tenant) return null;
    return resolveCredentials(selectCredentialSource(tenant));
}
