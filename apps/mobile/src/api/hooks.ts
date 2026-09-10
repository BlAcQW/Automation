import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import {
  AppNotification,
  BillingStatus,
  BlackoutDate,
  Booking,
  Conversation,
  DashboardStats,
  Message,
  MessageTemplate,
  Order,
  Product,
  Service,
  TeamMember,
  WhatsappStatus,
  WorkingHour,
} from './types';

// Some list endpoints return an array, others an envelope { data: [...] }.
function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const maybe = (payload as { data?: unknown; items?: unknown })?.data ?? (payload as { items?: unknown })?.items;
  return Array.isArray(maybe) ? (maybe as T[]) : [];
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => (await api.get('/dashboard/stats')).data,
    refetchInterval: 60_000,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async (): Promise<Conversation[]> => asArray<Conversation>((await api.get('/conversations')).data),
    refetchInterval: 15_000,
  });
}

export function useMessages(conversationId: string) {
  return useQuery({
    queryKey: ['messages', conversationId],
    queryFn: async (): Promise<Message[]> =>
      asArray<Message>((await api.get(`/conversations/${conversationId}/messages`)).data),
    refetchInterval: 5_000,
    enabled: !!conversationId,
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) =>
      (await api.post(`/conversations/${conversationId}/messages`, { content })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useResumeBot(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/conversations/${conversationId}/resume-bot`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useBookings() {
  return useQuery({
    queryKey: ['bookings'],
    queryFn: async (): Promise<Booking[]> => asArray<Booking>((await api.get('/bookings')).data),
    refetchInterval: 30_000,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async (): Promise<AppNotification[]> =>
      asArray<AppNotification>((await api.get('/notifications')).data),
    refetchInterval: 30_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async (): Promise<number> => {
      const data = (await api.get('/notifications/unread-count')).data;
      return typeof data === 'number' ? data : (data?.count ?? data?.unread ?? 0);
    },
    refetchInterval: 30_000,
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post('/notifications/mark-all-read')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useInitBookingPayment(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ authorizationUrl?: string }> => {
      const data = (await api.post(`/payments/bookings/${bookingId}/initialize`)).data;
      return { authorizationUrl: data?.authorizationUrl ?? data?.paymentAuthorizationUrl ?? data?.url };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useWhatsappStatus() {
  return useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: async (): Promise<WhatsappStatus> => (await api.get('/whatsapp/status')).data,
  });
}

export function useConnectWhatsapp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { phoneNumberId: string; accountId: string; accessToken: string; displayNumber?: string }) =>
      (await api.post('/whatsapp/connect', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp-status'] }),
  });
}

// ---- Services ----
export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: async (): Promise<Service[]> => asArray<Service>((await api.get('/services')).data),
  });
}

export interface ServiceInput {
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  category?: string;
  depositAmount?: number | null;
  isActive?: boolean;
}

export function useSaveService(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInput) =>
      id ? (await api.patch(`/services/${id}`, input)).data : (await api.post('/services', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/services/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useToggleService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/services/${id}/toggle`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

// ---- Availability ----
export function useWorkingHours() {
  return useQuery({
    queryKey: ['working-hours'],
    queryFn: async (): Promise<WorkingHour[]> => asArray<WorkingHour>((await api.get('/availability/hours')).data),
  });
}

export function useSaveWorkingHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hours: WorkingHour[]) => (await api.put('/availability/hours', { hours })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['working-hours'] }),
  });
}

export function useBlackouts() {
  return useQuery({
    queryKey: ['blackouts'],
    queryFn: async (): Promise<BlackoutDate[]> => asArray<BlackoutDate>((await api.get('/availability/blackouts')).data),
  });
}

export function useAddBlackout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { date: string; reason?: string }) =>
      (await api.post('/availability/blackouts', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blackouts'] }),
  });
}

export function useDeleteBlackout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/availability/blackouts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blackouts'] }),
  });
}

// ---- Templates ----
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async (): Promise<MessageTemplate[]> => asArray<MessageTemplate>((await api.get('/templates')).data),
  });
}

// ---- Billing / Plan & Usage ----
export function useBillingStatus() {
  return useQuery({
    queryKey: ['billing-status'],
    queryFn: async (): Promise<BillingStatus> => (await api.get('/billing/status')).data,
  });
}

// ---- Profile ----
export interface ProfileInput {
  name?: string;
  businessName?: string;
  timezone?: string;
  outOfWindowMessagesEnabled?: boolean;
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (input: ProfileInput) => (await api.patch('/auth/profile', input)).data,
  });
}

// ---- Products (PRODUCT mode) ----
export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => asArray<Product>((await api.get('/products')).data),
  });
}

export interface ProductInput {
  name: string;
  description?: string;
  price: number;
  stock: number;
  category?: string;
  isActive?: boolean;
}

export function useSaveProduct(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductInput) =>
      id ? (await api.patch(`/products/${id}`, input)).data : (await api.post('/products', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/products/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useToggleProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/products/${id}/toggle`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

// ---- Orders (PRODUCT mode) ----
export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async (): Promise<Order[]> => asArray<Order>((await api.get('/orders')).data),
    refetchInterval: 30_000,
  });
}

export function useUpdateOrderStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: string) => (await api.patch(`/orders/${id}`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

// ---- Team (staff) ----
export function useTeam() {
  return useQuery({
    queryKey: ['team'],
    queryFn: async (): Promise<TeamMember[]> => {
      const data = (await api.get('/users')).data;
      return asArray<TeamMember>(data?.users ?? data);
    },
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; email: string; password: string }) =>
      (await api.post('/users', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name?: string; isActive?: boolean }) =>
      (await api.patch(`/users/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
}
