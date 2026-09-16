import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useAuth } from '@/auth/context';
import { useServices, useToggleService } from '@/api/hooks';
import { Service } from '@/api/types';
import { Text, Card, Badge, EmptyState, HeaderAction, QueryState} from '@/components/ui';
import { ProductsList } from '@/features/products/ProductsList';
import { TAB_BAR_INSET } from '@/lib/layout';
import { LargeHeader } from '@/components/ui';

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
  const { data, isLoading, isError, isRefetching, refetch } = useServices();
  const isProduct = tenant?.businessType === 'PRODUCT';

  // PRODUCT tenants manage Products in this tab (relabeled in _layout).
  if (isProduct) return <ProductsList />;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <LargeHeader
        title="Services"
        actions={
          <HeaderAction
            icon="add"
            label="Add service"
            onPress={() => router.push('/services/new')}
          />
        }
      />
      {/* Failure must never render as emptiness — see ui/QueryState. */}
      {isLoading || isError ? (
        <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} >
          <></>
        </QueryState>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <ServiceRow item={item} />}
          contentContainerStyle={
            (data ?? []).length === 0
              ? { flex: 1, paddingBottom: TAB_BAR_INSET }
              : { padding: t.space.lg, gap: t.space.md, paddingBottom: TAB_BAR_INSET }
          }
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
          ListEmptyComponent={
            <EmptyState icon="pricetags-outline" title="No services yet" subtitle="Add the services customers can book through your bot." />
          }
        />
      )}

    </View>
  );
}
