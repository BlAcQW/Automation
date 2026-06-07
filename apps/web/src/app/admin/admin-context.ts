'use client';

import { createContext, useContext } from 'react';

/**
 * Admin auth context — extracted from layout.tsx so the layout file only
 * exports what Next.js 14 App Router allows (`default`, `metadata`,
 * `viewport`, `generateMetadata`). Custom hook exports from a `layout.tsx`
 * fail `next build` with: "X is not a valid Layout export field."
 */

export interface Admin {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
}

export interface AdminContextType {
    admin: Admin | null;
    isLoading: boolean;
    logout: () => void;
}

export const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function useAdmin(): AdminContextType {
    const context = useContext(AdminContext);
    if (!context) {
        throw new Error('useAdmin must be used within AdminLayout');
    }
    return context;
}
