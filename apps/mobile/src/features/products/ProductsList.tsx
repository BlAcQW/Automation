import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useProducts, useToggleProduct } from '@/api/hooks';
import { Product } from '@/api/types';
import { Text, Card, Badge, EmptyState } from '@/components/ui';

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
  const { data, isLoading, isRefetching, refetch } = useProducts();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
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
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="cube-outline" title="No products yet" subtitle="Add products your customers can order over WhatsApp." />}
        />
      )}
      <Pressable
        onPress={() => router.push('/products/new')}
        accessibilityRole="button"
        accessibilityLabel="Add product"
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
