import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Product } from '@/api/types';
import { useDeleteProduct, useSaveProduct, ProductInput } from '@/api/hooks';
import { AppHeader } from '@/components/AppHeader';
import { Field, Button, SwitchRow, Card, Text } from '@/components/ui';

export function ProductForm({ existing }: { existing?: Product }) {
  const t = useTheme();
  const router = useRouter();
  const save = useSaveProduct(existing?.id);
  const del = useDeleteProduct();

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [stock, setStock] = useState(existing ? String(existing.stock) : '0');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    const priceNum = Number(price);
    const stockNum = Number(stock);
    if (!name.trim()) return setError('Give the product a name.');
    if (Number.isNaN(priceNum) || priceNum < 0) return setError('Enter a valid price.');
    if (Number.isNaN(stockNum) || stockNum < 0) return setError('Enter a valid stock count.');

    const input: ProductInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: priceNum,
      stock: stockNum,
      category: category.trim() || undefined,
      isActive,
    };
    try {
      await save.mutateAsync(input);
      router.back();
    } catch {
      setError('Could not save. Check your details and try again.');
    }
  }

  function onDelete() {
    if (!existing) return;
    Alert.alert('Delete product', `Delete "${existing.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await del.mutateAsync(existing.id).catch(() => undefined);
          router.back();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title={existing ? 'Edit product' : 'New product'} />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
        <Card padded style={{ gap: t.space.lg }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Shea Butter 200g" />
          <Field label="Description" value={description ?? ''} onChangeText={setDescription} placeholder="Optional" multiline />
          <View style={{ flexDirection: 'row', gap: t.space.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Stock" value={stock} onChangeText={setStock} keyboardType="number-pad" placeholder="0" />
            </View>
          </View>
          <Field label="Category" value={category ?? ''} onChangeText={setCategory} placeholder="Optional" />
          <SwitchRow label="Active" description="Customers can order this product" value={isActive} onValueChange={setIsActive} />
        </Card>

        {error ? (
          <Text variant="bodySm" tone="danger">
            {error}
          </Text>
        ) : null}

        <Button label={existing ? 'Save changes' : 'Create product'} fullWidth loading={save.isPending} onPress={onSave} />
        {existing ? <Button label="Delete product" variant="danger" fullWidth loading={del.isPending} onPress={onDelete} /> : null}
      </ScrollView>
    </View>
  );
}
