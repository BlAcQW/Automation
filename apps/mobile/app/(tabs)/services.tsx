import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useAuth } from '@/auth/context';
import { useServices, useToggleService } from '@/api/hooks';
import { Service } from '@/api/types';
import { Text, Card, Badge, EmptyState } from '@/components/ui';
import { ProductsList } from '@/features/products/ProductsList';

function ServiceRow({ item }: { item: Service }) {
  const t = useTheme();
  const router = useRouter();
  const toggle = useToggleService();

  return (
    <Pressable onPress={() => router.push(`/services/${item.id}`)}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="body" weight="semi" numberOfLines={1}>
            {item.name}
          </Text>
          <Text variant="caption" tone="muted">
            {String(item.price)} · {item.durationMinutes} min{item.category ? ` · ${item.category}` : ''}
          </Text>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => toggle.mutate(item.id)}
          accessibilityRole="button"
          accessibilityLabel={item.isActive ? 'Deactivate service' : 'Activate service'}
        >
          <Badge label={item.isActive ? 'Active' : 'Off'} tone={item.isActive ? 'success' : 'neutral'} />
        </Pressable>
      </Card>
    </Pressable>
  );
}

export default function ServicesScreen() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useAuth();
  const { data, isLoading, isRefetching, refetch } = useServices();

  // PRODUCT tenants manage Products in this tab (relabeled in _layout).
  if (tenant?.businessType === 'PRODUCT') return <ProductsList />;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <ServiceRow item={item} />}
          contentContainerStyle={
            (data ?? []).length === 0 ? { flex: 1 } : { padding: t.space.lg, gap: t.space.md, paddingBottom: 96 }
          }
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
          ListEmptyComponent={
            <EmptyState icon="pricetags-outline" title="No services yet" subtitle="Add the services customers can book through your bot." />
          }
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={() => router.push('/services/new')}
        accessibilityRole="button"
        accessibilityLabel="Add service"
        style={({ pressed }) => ({
          position: 'absolute',
          right: t.space.lg,
          bottom: t.space.xl,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: t.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.9 : 1,
          ...t.elevation(3),
        })}
      >
        <Ionicons name="add" size={30} color={t.colors.onPrimary} />
      </Pressable>
    </View>
  );
}
