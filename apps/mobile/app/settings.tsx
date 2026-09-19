import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme, useThemeMode, type ThemeMode } from '@/theme';
import { useAuth } from '@/auth/context';
import { useBillingStatus, useRedeemPromo, useUpdateProfile } from '@/api/hooks';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Field, Button, SwitchRow, Badge, Segmented } from '@/components/ui';

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

const APPEARANCE_OPTIONS: { value: ThemeMode; label: string; icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline' }[] = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const { mode, scheme, setMode } = useThemeMode();
  const { user, tenant, refreshUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const { data: billing } = useBillingStatus();

  const [name, setName] = useState(user?.name ?? '');
  const [businessName, setBusinessName] = useState(tenant?.name ?? '');
  const [reminders, setReminders] = useState(tenant?.outOfWindowMessagesEnabled ?? true);
  const [depositRequired, setDepositRequired] = useState(tenant?.depositRequired ?? true);
  const [depositAmount, setDepositAmount] = useState(String(tenant?.defaultDepositAmount ?? 50));
  const [note, setNote] = useState<string | null>(null);
  const currency = tenant?.currency ?? 'GHS';

  const redeemPromo = useRedeemPromo();
  const [promo, setPromo] = useState('');
  const [promoNote, setPromoNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function onRedeem() {
    setPromoNote(null);
    try {
      const r = await redeemPromo.mutateAsync(promo.trim());
      const until = new Date(r.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      setPromoNote({ ok: true, text: `${r.planName} until ${until}.` });
      setPromo('');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setPromoNote({ ok: false, text: msg ?? 'That code could not be applied.' });
    }
  }

  async function onSave() {
    setNote(null);
    const amount = Number(depositAmount.replace(/[^0-9.]/g, ''));
    if (depositRequired && (!Number.isFinite(amount) || amount <= 0)) {
      setNote('Enter a deposit amount above 0, or switch deposits off.');
      return;
    }
    await updateProfile
      .mutateAsync({
        name: name.trim(),
        businessName: businessName.trim(),
        outOfWindowMessagesEnabled: reminders,
        depositRequired,
        ...(Number.isFinite(amount) && amount > 0 ? { defaultDepositAmount: amount } : {}),
      })
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

        <Text variant="h3" weight="bold" style={{ marginTop: t.space.sm }}>
          Deposits
        </Text>
        <Card padded style={{ gap: t.space.lg }}>
          <SwitchRow
            label="Ask for a deposit"
            description="A booking is only confirmed once the customer pays. Unpaid holds are released after 30 minutes."
            value={depositRequired}
            onValueChange={setDepositRequired}
          />
          {depositRequired ? (
            <Field
              label={`Deposit amount (${currency})`}
              value={depositAmount}
              onChangeText={setDepositAmount}
              keyboardType="decimal-pad"
              placeholder="50"
            />
          ) : null}
          <Text variant="caption" tone="muted">
            You can set a different deposit on any service, including none.
          </Text>
        </Card>
        <Button label="Save changes" fullWidth loading={updateProfile.isPending} onPress={onSave} />
        {note ? (
          <Text variant="caption" tone="success" center>
            {note}
          </Text>
        ) : null}

        <Text variant="h3" weight="bold" style={{ marginTop: t.space.sm }}>
          Appearance
        </Text>
        <Card padded style={{ gap: t.space.md }}>
          <Segmented
            label="Appearance"
            options={APPEARANCE_OPTIONS}
            value={mode}
            onChange={setMode}
          />
          <Text variant="caption" tone="muted">
            {mode === 'system'
              ? `Following your device setting (currently ${scheme}).`
              : `Always ${mode}, whatever your device is set to.`}
          </Text>
        </Card>

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
          <Field
            label="Have a promo code?"
            value={promo}
            onChangeText={(v) => setPromo(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="LAUNCH-XXXXXXXX"
          />
          <Button
            label="Apply code"
            variant="secondary"
            loading={redeemPromo.isPending}
            disabled={!promo.trim()}
            onPress={onRedeem}
          />
          {promoNote ? (
            <Text variant="caption" tone={promoNote.ok ? 'success' : 'danger'}>
              {promoNote.text}
            </Text>
          ) : null}
          <Text variant="caption" tone="subtle">
            Manage or upgrade your plan from the web dashboard.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}
