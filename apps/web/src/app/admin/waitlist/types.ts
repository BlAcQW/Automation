import type { WaitlistStatus } from '@/lib/waitlist';

/** One row of GET /admin/waitlist (apps/api/src/services/waitlist.ts adminView). */
export interface WaitlistEntry {
    id: string;
    name: string;
    businessName: string;
    businessType: string;
    phone: string;
    email: string;
    city: string;
    heardFrom: string | null;
    message: string | null;
    status: WaitlistStatus;
    adminNotes: string | null;
    invitedAt: string | null;
    inviteExpiresAt: string | null;
    invitedByAdminId: string | null;
    inviteUsedAt: string | null;
    joinedTenantId: string | null;
    consentAt: string;
    createdAt: string;
    updatedAt: string;
    inviteState: 'valid' | 'expired' | 'used' | 'invalid' | null;
}

export interface WaitlistPage {
    data: WaitlistEntry[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface WaitlistSummary {
    total: number;
    newThisWeek: number;
    byStatus: Record<WaitlistStatus, number>;
    byBusinessType: Record<string, number>;
}

export interface InviteResult {
    link: string;
    expiresAt: string;
    emailed: boolean;
    emailError?: 'email_not_configured' | 'send_failed';
    entry: WaitlistEntry;
}
