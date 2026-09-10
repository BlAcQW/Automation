import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/auth/context';
import { useBillingStatus, useUpdateProfile } from '@/api/hooks';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Field, Button, SwitchRow, Badge } from '@/components/ui';

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const t = useTheme();
  const pct = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone = pct >= 1 ? t.colors.danger : pct >= 0.8 ? t.colors.warning : t.colors.primary;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: tone }} />
      </View>
      <Text variant="caption" tone="muted">
        {used} of {limit} messages used this cycle
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const t = useTheme();
  const { user, tenant, refreshUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const { data: billing } = useBillingStatus();

  const [name, setName] = useState(user?.name ?? '');
  const [businessName, setBusinessName] = useState(tenant?.name ?? '');
  const [reminders, setReminders] = useState(tenant?.outOfWindowMessagesEnabled ?? true);
  const [note, setNote] = useState<string | null>(null);

  async function onSave() {
    setNote(null);
    await updateProfile
      .mutateAsync({ name: name.trim(), businessName: businessName.trim(), outOfWindowMessagesEnabled: reminders })
      .catch(() => undefined);
    await refreshUser();
    setNote('Saved.');
  }

  const used = billing?.usage?.used ?? billing?.used ?? 0;
  const limit = billing?.usage?.limit ?? billing?.limit ?? billing?.plan?.monthlyMessageQuota ?? 0;
  const planName = billing?.plan?.name ?? billing?.plan?.id ?? billing?.planId ?? 'Free';
  const status = billing?.subscriptionStatus;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title="Settings" />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
        <Text variant="h3" weight="bold">
          Profile
        </Text>
        <Card padded style={{ gap: t.space.lg }}>
          <Field label="Your name" value={name} onChangeText={setName} />
          <Field label="Business name" value={businessName} onChangeText={setBusinessName} />
          <SwitchRow
            label="Automated reminders"
            description="Send booking reminders outside the 24-hour window"
            value={reminders}
            onValueChange={setReminders}
          />
        </Card>
        <Button label="Save changes" fullWidth loading={updateProfile.isPending} onPress={onSave} />
        {note ? (
          <Text variant="caption" tone="success" center>
            {note}
          </Text>
        ) : null}

        <Text variant="h3" weight="bold" style={{ marginTop: t.space.sm }}>
          Plan & usage
        </Text>
        <Card padded style={{ gap: t.space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <Text variant="h2" weight="extra" style={{ textTransform: 'capitalize' }}>
              {String(planName)}
            </Text>
            {status ? (
              <Badge
                label={status === 'TRIALING' ? 'Trial' : status === 'ACTIVE' ? 'Active' : status === 'PAST_DUE' ? 'Past due' : 'Cancelled'}
                tone={status === 'ACTIVE' ? 'success' : status === 'PAST_DUE' ? 'danger' : status === 'TRIALING' ? 'primary' : 'neutral'}
              />
            ) : null}
          </View>
          <UsageBar used={used} limit={limit} />
          <Text variant="caption" tone="subtle">
            Manage or upgrade your plan from the web dashboard.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}
