import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useProducts, useToggleProduct } from '@/api/hooks';
import { Product } from '@/api/types';
import { Text, Card, Badge, EmptyState } from '@/components/ui';
import { LargeHeader, HeaderAction } from '@/components/ui';
import { usePullRefresh } from '@/lib/usePullRefresh';

function ProductRow({ item }: { item: Product }) {
  const t = useTheme();
  const router = useRouter();
  const toggle = useToggleProduct();
  const low = item.stock <= 0;

  return (
    <Pressable onPress={() => router.push(`/products/${item.id}`)}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="body" weight="semi" numberOfLines={1}>
            {item.name}
          </Text>
          <Text variant="caption" tone={low ? 'danger' : 'muted'}>
            {String(item.price)} · {low ? 'Out of stock' : `${item.stock} in stock`}
            {item.category ? ` · ${item.category}` : ''}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => toggle.mutate(item.id)} accessibilityLabel="Toggle product">
          <Badge label={item.isActive ? 'Active' : 'Off'} tone={item.isActive ? 'success' : 'neutral'} />
        </Pressable>
      </Card>
    </Pressable>
  );
}

export function ProductsList() {
  const t = useTheme();
  const router = useRouter();
  const { data, isLoading, refetch } = useProducts();
  const { refreshing, onRefresh } = usePullRefresh(refetch);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <LargeHeader
        title="Products"
        actions={
          <HeaderAction
            icon="add"
            label="Add product"
            onPress={() => router.push('/products/new')}
          />
        }
      />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <ProductRow item={item} />}
          contentContainerStyle={
            (data ?? []).length === 0 ? { flex: 1 } : { padding: t.space.lg, gap: t.space.md, paddingBottom: 96 }
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="cube-outline" title="No products yet" subtitle="Add products your customers can order over WhatsApp." />}
        />
      )}
    </View>
  );
}
