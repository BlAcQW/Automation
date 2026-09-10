// Domain types mirrored from apps/api/prisma/schema.prisma. Fields are kept
// optional where the exact API projection isn't guaranteed, so the UI degrades
// gracefully rather than crashing on a missing key.

export type ConversationState = 'BOT_ACTIVE' | 'HUMAN_ACTIVE';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export interface Conversation {
  id: string;
  customerName?: string | null;
  customerPhone: string;
  state: ConversationState;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  lastMessageDirection?: MessageDirection | null;
  lastInboundAt?: string | null;
  assignedUserId?: string | null;
}

export interface Message {
  id: string;
  direction: MessageDirection;
  content: string;
  messageType?: string;
  createdAt: string;
}

export type BookingStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'NO_SHOW';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';

export interface Booking {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName?: string | null;
  service?: { name?: string } | null;
  startTime: string;
  endTime?: string;
  status: BookingStatus;
  paymentStatus?: PaymentStatus;
  bookingReference: string;
  paymentAuthorizationUrl?: string | null;
  notes?: string | null;
}

export type NotificationType =
  | 'NEW_BOOKING'
  | 'BOOKING_CANCELLED'
  | 'NEW_CONVERSATION'
  | 'SYSTEM';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface WhatsappStatus {
  connected: boolean;
  phoneNumberId?: string | null;
  displayNumber?: string | null;
}

export interface DashboardStats {
  totalBookings?: number;
  todayBookings?: number;
  activeConversations?: number;
  totalCustomers?: number;
  totalSales?: number;
  totalOrders?: number;
}

export interface Service {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  durationMinutes: number;
  category?: string | null;
  depositAmount?: number | string | null;
  isActive: boolean;
}

export interface WorkingHour {
  id?: string;
  dayOfWeek: number; // 0=Sun … 6=Sat
  startTime: string; // "HH:MM"
  endTime: string;
  isActive: boolean;
}

export interface BlackoutDate {
  id: string;
  date: string; // ISO
  reason?: string | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category?: string;
  purpose?: string;
  variableCount?: number;
  isApproved: boolean;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  stock: number;
  category?: string | null;
  imageUrl?: string | null;
  isActive: boolean;
}

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderItem {
  id: string;
  productId?: string;
  quantity: number;
  unitPrice: number | string;
  product?: { name?: string } | null;
}

export interface Order {
  id: string;
  orderRef: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number | string;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  createdAt: string;
  deliveryAddress?: string | null;
  items?: OrderItem[];
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'STAFF';
  isActive: boolean;
  createdAt?: string;
}

export interface BillingStatus {
  planId?: string;
  plan?: { id?: string; name?: string; monthlyMessageQuota?: number };
  subscriptionStatus?: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  usage?: { used?: number; limit?: number };
  used?: number;
  limit?: number;
}
