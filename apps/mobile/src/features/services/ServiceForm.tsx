import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Service } from '@/api/types';
import { useDeleteService, useSaveService, ServiceInput } from '@/api/hooks';
import { AppHeader } from '@/components/AppHeader';
import { Field, Button, SwitchRow, Card, Text } from '@/components/ui';

export function ServiceForm({ existing }: { existing?: Service }) {
  const t = useTheme();
  const router = useRouter();
  const save = useSaveService(existing?.id);
  const del = useDeleteService();

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [duration, setDuration] = useState(existing ? String(existing.durationMinutes) : '30');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [deposit, setDeposit] = useState(existing?.depositAmount != null ? String(existing.depositAmount) : '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    const priceNum = Number(price);
    const durationNum = Number(duration);
    if (!name.trim()) return setError('Give the service a name.');
    if (Number.isNaN(priceNum) || priceNum < 0) return setError('Enter a valid price.');
    if (Number.isNaN(durationNum) || durationNum <= 0) return setError('Enter a valid duration in minutes.');

    const input: ServiceInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: priceNum,
      durationMinutes: durationNum,
      category: category.trim() || undefined,
      depositAmount: deposit.trim() ? Number(deposit) : null,
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
    Alert.alert('Delete service', `Delete "${existing.name}"? This can't be undone.`, [
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
      <AppHeader title={existing ? 'Edit service' : 'New service'} />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
        <Card padded style={{ gap: t.space.lg }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Haircut" />
          <Field label="Description" value={description ?? ''} onChangeText={setDescription} placeholder="Optional" multiline />
          <View style={{ flexDirection: 'row', gap: t.space.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Duration (min)" value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="30" />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: t.space.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Category" value={category ?? ''} onChangeText={setCategory} placeholder="Optional" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Deposit" value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" placeholder="None" hint="Leave blank for none" />
            </View>
          </View>
          <SwitchRow label="Active" description="Customers can book this service" value={isActive} onValueChange={setIsActive} />
        </Card>

        {error ? (
          <Text variant="bodySm" tone="danger">
            {error}
          </Text>
        ) : null}

        <Button label={existing ? 'Save changes' : 'Create service'} fullWidth loading={save.isPending} onPress={onSave} />
        {existing ? (
          <Button label="Delete service" variant="danger" fullWidth onPress={onDelete} loading={del.isPending} />
        ) : null}
      </ScrollView>
    </View>
  );
}
