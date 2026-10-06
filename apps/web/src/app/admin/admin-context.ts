'use client';

import { createContext, useContext } from 'react';

/**
 * Admin auth context — extracted from layout.tsx so the layout file only
 * exports what Next.js 14 App Router allows (`default`, `metadata`,
 * `viewport`, `generateMetadata`). Custom hook exports from a `layout.tsx`
 * fail `next build` with: "X is not a valid Layout export field."
 */

export type AdminRole = 'OWNER' | 'FINANCE' | 'SUPPORT' | 'READONLY';

export interface Admin {
    id: string;
    email: string;
    name: string;
    /** @deprecated legacy flag; use `role` / `can()`. */
    isSuperAdmin: boolean;
    role: AdminRole;
    /** What this role may do, from the API (services/admin-permissions.ts). The API enforces it; the UI only hides. */
    permissions: string[];
    totpEnabled: boolean;
    /** The platform requires 2FA for every admin. */
    twoFactorRequired: boolean;
    recoveryCodesRemaining?: number;
}

export interface AdminContextType {
    admin: Admin | null;
    isLoading: boolean;
    logout: () => void;
    /** Does the signed-in admin's role hold this permission? (Display only: the API enforces.) */
    can: (permission: string) => boolean;
    /** Re-read /admin/auth/me (e.g. after enabling 2FA). */
    reload: () => Promise<void>;
}

export const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function useAdmin(): AdminContextType {
    const context = useContext(AdminContext);
    if (!context) {
        throw new Error('useAdmin must be used within AdminLayout');
    }
    return context;
}
