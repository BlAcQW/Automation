import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/theme';
import { useDashboardStats, useServices, useWhatsappStatus } from '@/api/hooks';
import { Text, Card, Badge, Bone, PressableScale } from '@/components/ui';
import { TAB_BAR_INSET } from '@/lib/layout';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { LargeHeader } from '@/components/ui';

type IoniconName = keyof typeof Ionicons.glyphMap;

function StatCard({ icon, label, value }: { icon: IoniconName; label: string; value: number | string }) {
  const t = useTheme();
  return (
    <Card style={{ flexGrow: 1, flexBasis: '46%', gap: t.space.sm }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: t.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={19} color={t.colors.primaryText} />
      </View>
      <Text variant="h1" weight="extra">
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </Card>
  );
}

/** Same footprint as StatCard so the grid doesn't reflow when numbers land. */
function StatCardSkeleton() {
  const t = useTheme();
  return (
    <Card style={{ flexGrow: 1, flexBasis: '46%', gap: t.space.sm }}>
      <Bone width={36} height={36} radius={10} />
      <Bone width={64} height={28} />
      <Bone width={96} height={14} />
    </Card>
  );
}

/**
 * The three things a new business must do before the product does anything,
 * in order. Derived from live data, so it disappears by itself once the last
 * step is done and never nags someone who has finished.
 */
function GettingStarted() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';
  const { data: services } = useServices();
  const { data: wa } = useWhatsappStatus();

  if (services === undefined || wa === undefined) return null;

  const steps = [
    {
      key: 'catalogue',
      title: isProduct ? 'Add your products' : 'Add your services',
      detail: isProduct ? 'What you sell, with prices.' : 'What you offer, how long it takes, what it costs.',
      icon: 'pricetags-outline' as IoniconName,
      href: '/services/new' as const,
      done: services.length > 0,
    },
    {
      key: 'whatsapp',
      title: 'Connect your WhatsApp number',
      detail: 'The number customers already message you on.',
      icon: 'logo-whatsapp' as IoniconName,
      href: '/whatsapp' as const,
      done: !!wa.connected,
    },
  ];
  const remaining = steps.filter((s) => !s.done);
  if (remaining.length === 0) return null;

  return (
    <Card padded={false} style={{ borderColor: t.colors.primary, borderWidth: 1 }}>
      <View style={{ padding: t.space.lg, gap: 2 }}>
        <Text variant="caption" tone="primary" weight="medium">
          {steps.length - remaining.length} of {steps.length} done
        </Text>
        <Text variant="h2" weight="bold">
          Set up your business
        </Text>
        <Text variant="bodySm" tone="muted">
          Then customers can book by sending you a WhatsApp message.
        </Text>
      </View>
      {steps.map((s, i) => (
        <PressableScale
          key={s.key}
          disabled={s.done}
          onPress={() => router.push(s.href)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.md,
            paddingHorizontal: t.space.lg,
            paddingVertical: t.space.md,
            borderTopWidth: 0.5,
            borderTopColor: t.colors.divider,
            opacity: s.done ? 0.6 : 1,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: s.done ? t.colors.primary : 'transparent',
              borderWidth: s.done ? 0 : 1,
              borderColor: t.colors.border,
            }}
          >
            {s.done ? (
              <Ionicons name="checkmark" size={18} color={t.colors.onPrimary} />
            ) : (
              <Text variant="bodySm" weight="semi">
                {i + 1}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text
              variant="bodySm"
              weight="semi"
              style={s.done ? { textDecorationLine: 'line-through' } : undefined}
            >
              {s.title}
            </Text>
            {!s.done ? (
              <Text variant="caption" tone="muted">
                {s.detail}
              </Text>
            ) : null}
          </View>
          {!s.done ? <Ionicons name="chevron-forward" size={18} color={t.colors.textSubtle} /> : null}
        </PressableScale>
      ))}
    </Card>
  );
}

export default function DashboardScreen() {
  const t = useTheme();
  const router = useRouter();
  const { tenant, user } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';
  const { data, isLoading, refetch, isError } = useDashboardStats();
  const { refreshing, onRefresh } = usePullRefresh(refetch);
  const { data: wa } = useWhatsappStatus();

  const cards: { icon: IoniconName; label: string; value: number }[] = isProduct
    ? [
        { icon: 'cash-outline', label: 'Total sales', value: data?.totalSales ?? 0 },
        { icon: 'cart-outline', label: 'Orders', value: data?.totalOrders ?? 0 },
        { icon: 'chatbubbles-outline', label: 'Open chats', value: data?.activeConversations ?? 0 },
        { icon: 'people-outline', label: 'Customers', value: data?.totalCustomers ?? 0 },
      ]
    : [
        { icon: 'today-outline', label: 'Bookings today', value: data?.todayBookings ?? 0 },
        { icon: 'calendar-outline', label: 'All bookings', value: data?.totalBookings ?? 0 },
        { icon: 'chatbubbles-outline', label: 'Open chats', value: data?.activeConversations ?? 0 },
        { icon: 'people-outline', label: 'Customers', value: data?.totalCustomers ?? 0 },
      ];

  const firstName = (user?.name ?? '').split(' ')[0];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <LargeHeader title="Overview" />
      <ScrollView
        style={{ flex: 1, backgroundColor: t.colors.background }}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: TAB_BAR_INSET }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}
      >
        <View style={{ gap: 2 }}>
          <Text variant="bodySm" tone="muted">
            {firstName ? `Hi ${firstName},` : 'Welcome back,'}
          </Text>
          <Text variant="h1" weight="extra">
            {tenant?.name ?? 'Your business'}
          </Text>
        </View>

        <GettingStarted />

        {/* WhatsApp connection strip: only worth a row once it is connected;
            before that the setup card above is the call to action. */}
        {wa?.connected ? (
          <Pressable onPress={() => router.push('/whatsapp')}>
            <Card padded style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: t.colors.successSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="logo-whatsapp" size={22} color={t.colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySm" weight="semi">
                  WhatsApp connected
                </Text>
                <Text variant="caption" tone="muted">
                  {wa.displayNumber ?? 'Assistant is answering'}
                </Text>
              </View>
              <Badge label="Live" tone="success" />
            </Card>
          </Pressable>
        ) : null}

        {isError ? (
          <Text variant="bodySm" tone="danger">
            Couldn&apos;t load your numbers. Pull down to try again.
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md }}>
          {isLoading
            ? [0, 1, 2, 3].map((i) => <StatCardSkeleton key={i} />)
            : cards.map((c) => <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} />)}
        </View>
      </ScrollView>
    </View>
  );
}
