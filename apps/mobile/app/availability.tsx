import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import {
  useAddBlackout,
  useBlackouts,
  useDeleteBlackout,
  useSaveWorkingHours,
  useWorkingHours,
} from '@/api/hooks';
import { WorkingHour } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Button, Field, SwitchRow, DateTimeField } from '@/components/ui';
import { formatDay } from '@/lib/format';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function seedWeek(server: WorkingHour[] | undefined): WorkingHour[] {
  return Array.from({ length: 7 }, (_, day) => {
    const found = server?.find((h) => h.dayOfWeek === day);
    return (
      found ?? {
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '17:00',
        isActive: day >= 1 && day <= 5,
      }
    );
  });
}

export default function AvailabilityScreen() {
  const t = useTheme();
  const { data: serverHours, isLoading } = useWorkingHours();
  const saveHours = useSaveWorkingHours();
  const { data: blackouts } = useBlackouts();
  const addBlackout = useAddBlackout();
  const delBlackout = useDeleteBlackout();

  const [week, setWeek] = useState<WorkingHour[]>(seedWeek(undefined));
  const [savedNote, setSavedNote] = useState(false);
  const [boDate, setBoDate] = useState('');
  const [boReason, setBoReason] = useState('');

  useEffect(() => {
    if (serverHours) setWeek(seedWeek(serverHours));
  }, [serverHours]);

  function update(day: number, patch: Partial<WorkingHour>) {
    setWeek((prev) => prev.map((h) => (h.dayOfWeek === day ? { ...h, ...patch } : h)));
    setSavedNote(false);
  }

  async function onSaveHours() {
    await saveHours.mutateAsync(week).catch(() => undefined);
    setSavedNote(true);
  }

  async function onAddBlackout() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(boDate.trim())) return;
    await addBlackout.mutateAsync({ date: boDate.trim(), reason: boReason.trim() || undefined }).catch(() => undefined);
    setBoDate('');
    setBoReason('');
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.background }}>
        <AppHeader title="Availability" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title="Availability" />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
        <Text variant="h3" weight="bold">
          Working hours
        </Text>
        <Card padded style={{ gap: t.space.lg }}>
          {week.map((h) => (
            <View key={h.dayOfWeek} style={{ gap: h.isActive ? t.space.sm : 0 }}>
              <SwitchRow
                label={DAY_LABELS[h.dayOfWeek]}
                value={h.isActive}
                onValueChange={(v) => update(h.dayOfWeek, { isActive: v })}
              />
              {h.isActive ? (
                <View style={{ flexDirection: 'row', gap: t.space.md }}>
                  <View style={{ flex: 1 }}>
                    <DateTimeField label="Open" mode="time" value={h.startTime} onChange={(v) => update(h.dayOfWeek, { startTime: v })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <DateTimeField label="Close" mode="time" value={h.endTime} onChange={(v) => update(h.dayOfWeek, { endTime: v })} />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
        <Button label="Save working hours" fullWidth loading={saveHours.isPending} onPress={onSaveHours} />
        {savedNote ? (
          <Text variant="caption" tone="success" center>
            Working hours saved.
          </Text>
        ) : null}

        <Text variant="h3" weight="bold" style={{ marginTop: t.space.sm }}>
          Blackout dates
        </Text>
        <Card padded style={{ gap: t.space.md }}>
          {(blackouts ?? []).length === 0 ? (
            <Text variant="bodySm" tone="muted">
              No blocked dates. Add days you&apos;re closed (holidays, time off).
            </Text>
          ) : (
            (blackouts ?? []).map((b) => (
              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
                <Ionicons name="close-circle-outline" size={18} color={t.colors.danger} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodySm" weight="medium">
                    {formatDay(b.date)}
                  </Text>
                  {b.reason ? (
                    <Text variant="caption" tone="muted">
                      {b.reason}
                    </Text>
                  ) : null}
                </View>
                <Pressable hitSlop={8} onPress={() => delBlackout.mutate(b.id)} accessibilityLabel="Remove blackout date">
                  <Ionicons name="trash-outline" size={18} color={t.colors.textSubtle} />
                </Pressable>
              </View>
            ))
          )}
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <DateTimeField label="Date" mode="date" value={boDate} onChange={setBoDate} placeholder="Pick a date" />
          <Field label="Reason" value={boReason} onChangeText={setBoReason} placeholder="Optional" />
          <Button label="Add blackout date" variant="secondary" fullWidth loading={addBlackout.isPending} onPress={onAddBlackout} />
        </Card>
      </ScrollView>
    </View>
  );
}
