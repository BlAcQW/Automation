'use client';

import { createAuthKit, type CoreRegisterData, type CoreUser, type TenantWith } from '@bookingflow/auth-client';
import { api, tokenStorage } from './api';

interface User extends CoreUser {
    role: 'OWNER' | 'STAFF';
}

/** Booking-vertical tenant fields. The shared core Tenant knows none of these. */
interface BookingTenantFields {
    businessType: 'PRODUCT' | 'SERVICE';
    whatsappConnected?: boolean;
    outOfWindowMessagesEnabled?: boolean;
    depositRequired?: boolean;
    /** Owner-only: hide most of each customer's contact from STAFF. */
    maskCustomerContact?: boolean;
    bookingCapacity?: number;
    defaultDepositAmount?: number;
}

type Tenant = TenantWith<BookingTenantFields>;

interface RegisterData extends CoreRegisterData {
    businessName: string;
    businessType: 'PRODUCT' | 'SERVICE';
}

// The access-token presence cookie (read by the Edge middleware) is on by
// default: name `accessToken`, 15-minute TTL matching the API's JWT_EXPIRES_IN.
export const { AuthProvider, useAuth, useRequireAuth } = createAuthKit<User, Tenant, RegisterData>({
    api,
    storage: tokenStorage,
    loginPath: '/login',
});
