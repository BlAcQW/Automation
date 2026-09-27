import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import {
  useAddBlackout,
  useBlackouts,
  useDeleteBlackout,
  useSaveWorkingHours,
  useUpdateProfile,
  useWorkingHours,
} from '@/api/hooks';
import { useAuth } from '@/auth/context';
import { WorkingHour } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Button, Field, SwitchRow, DateTimeField, QueryState} from '@/components/ui';
import { formatDay } from '@/lib/format';
import { useBottomInset } from '@/lib/layout';

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
  const bottomInset = useBottomInset();
  const { tenant, refreshUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const { data: serverHours, isLoading, isError } = useWorkingHours();
  const saveHours = useSaveWorkingHours();
  const { data: blackouts } = useBlackouts();
  const addBlackout = useAddBlackout();
  const delBlackout = useDeleteBlackout();

  const [week, setWeek] = useState<WorkingHour[]>(seedWeek(undefined));
  const [savedNote, setSavedNote] = useState(false);
  const [boDate, setBoDate] = useState('');
  const [boReason, setBoReason] = useState('');
  // Chairs / rooms / bays. Seeded from the session's tenant; the engine used
  // to offer a single booking per slot regardless of how many a business runs.
  const [capacity, setCapacity] = useState<number>(tenant?.bookingCapacity ?? 1);

  useEffect(() => {
    if (tenant?.bookingCapacity) setCapacity(tenant.bookingCapacity);
  }, [tenant?.bookingCapacity]);

  useEffect(() => {
    if (serverHours) setWeek(seedWeek(serverHours));
  }, [serverHours]);

  function update(day: number, patch: Partial<WorkingHour>) {
    setWeek((prev) => prev.map((h) => (h.dayOfWeek === day ? { ...h, ...patch } : h)));
    setSavedNote(false);
  }

  async function onSaveHours() {
    await saveHours.mutateAsync(week).catch(() => undefined);
    await updateProfile.mutateAsync({ bookingCapacity: capacity }).catch(() => undefined);
    await refreshUser().catch(() => undefined);
    setSavedNote(true);
  }

  async function onAddBlackout() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(boDate.trim())) return;
    await addBlackout.mutateAsync({ date: boDate.trim(), reason: boReason.trim() || undefined }).catch(() => undefined);
    setBoDate('');
    setBoReason('');
  }

  // Loading, failure and emptiness are three different facts. QueryState
  // keeps failure off the empty state, so an unreachable API never reads
  // as "you have no data".
  if (isLoading || isError) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.background }}>
        <QueryState isLoading={isLoading} isError={isError} >
          <></>
        </QueryState>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title="Availability" />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: bottomInset }}>
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
        <Card style={{ gap: t.space.sm }}>
          <Text variant="body" weight="semi">
            At the same time
          </Text>
          <Text variant="caption" tone="muted">
            How many customers you can serve at once — chairs, rooms or bays.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, marginTop: t.space.xs }}>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Fewer at a time"
              disabled={capacity <= 1}
              onPress={() => {
                setCapacity((c) => Math.max(1, c - 1));
                setSavedNote(false);
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: capacity <= 1 ? 0.4 : 1,
              }}
            >
              <Text variant="body" weight="semi">−</Text>
            </Pressable>
            <Text variant="h2" weight="semi" style={{ minWidth: 44, textAlign: 'center' }}>
              {capacity}
            </Text>
            <Pressable
              hitSlop={8}
              accessibilityLabel="More at a time"
              disabled={capacity >= 100}
              onPress={() => {
                setCapacity((c) => Math.min(100, c + 1));
                setSavedNote(false);
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: capacity >= 100 ? 0.4 : 1,
              }}
            >
              <Text variant="body" weight="semi">+</Text>
            </Pressable>
          </View>
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
