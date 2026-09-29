import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import {
  useMoney,
  useMomoProviders,
  usePreviewDestination,
  useSaveDestination,
  useWithdraw,
  type MoneyPayout,
  type MoneyState,
} from '@/api/hooks';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Badge, Button, Field, QueryState } from '@/components/ui';
import { useBottomInset } from '@/lib/layout';

/** Minor units to something a person reads. No float in, no float out. */
function money(minor: number, currency: string): string {
    return `${currency} ${(minor / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export default function MoneyScreen() {
    const t = useTheme();
    const bottomInset = useBottomInset();
    const { data, isLoading, isError, refetch } = useMoney();

    const [amount, setAmount] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [editingDestination, setEditingDestination] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    const withdraw = useWithdraw();

    const ready = data?.readyToWithdrawMinor ?? 0;
    // Typed in cedis, committed in pesewas. Rounding at the boundary keeps
    // the ledger in whole minor units.
    const amountMinor = Math.round((parseFloat(amount) || 0) * 100);
    const canWithdraw =
        !!data?.destination?.usable && ready > 0 && amountMinor > 0 && amountMinor <= ready;

    async function send() {
        setProblem(null);
        try {
            const res = await withdraw.mutateAsync({ amountMinor });
            setConfirming(false);
            setAmount('');
            setNotice(res.message);
        } catch (err: any) {
            setConfirming(false);
            setProblem(
                err?.response?.data?.message ??
                'That did not go through. Your money is still in your balance.',
            );
        }
    }

    return (
        <View style={{ flex: 1, backgroundColor: t.colors.background }}>
            <AppHeader title="Money" subtitle="What you've earned" />

            {isLoading || isError ? (
                <QueryState isLoading={isLoading} isError={isError} onRetry={refetch}>
                    <></>
                </QueryState>
            ) : (
                <ScrollView
                    contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: bottomInset }}
                >
                    {notice ? <Banner tone="success" text={notice} /> : null}
                    {problem ? <Banner tone="danger" text={problem} /> : null}

                    {/* Ready to withdraw — the number she came here for. */}
                    <Card padded style={{ gap: t.space.md }}>
                        <View>
                            <Text variant="caption" tone="muted">Ready to withdraw</Text>
                            <Text variant="h1" weight="semi">
                                {money(ready, data!.currency)}
                            </Text>
                        </View>

                        <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />

                        <View style={{ flexDirection: 'row', gap: t.space.lg }}>
                            <View style={{ flex: 1 }}>
                                <Text variant="caption" tone="muted">Still clearing</Text>
                                <Text variant="body" weight="medium">
                                    {money(data!.stillClearingMinor, data!.currency)}
                                </Text>
                                <Text variant="caption" tone="subtle">
                                    Jobs you haven&apos;t marked done
                                </Text>
                            </View>
                            {data!.onTheWayMinor > 0 ? (
                                <View style={{ flex: 1 }}>
                                    <Text variant="caption" tone="muted">On the way</Text>
                                    <Text variant="body" weight="medium">
                                        {money(data!.onTheWayMinor, data!.currency)}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    </Card>

                    {!data!.destination ? (
                        <Banner
                            tone="warning"
                            text="Add the Mobile Money number you want to be paid on, then you can withdraw any time."
                        />
                    ) : !data!.destination.usable ? (
                        <Banner
                            tone="warning"
                            text="Your new number is not active yet. For your safety it can receive money 24 hours after you change it."
                        />
                    ) : (
                        <Card padded style={{ gap: t.space.md }}>
                            <Field
                                label={`How much? (${data!.currency})`}
                                value={amount}
                                onChangeText={setAmount}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                            />
                            <Button
                                label="Send to my MoMo"
                                icon="send-outline"
                                fullWidth
                                disabled={!canWithdraw}
                                onPress={() => setConfirming(true)}
                            />
                            {ready > 0 ? (
                                <Pressable
                                    hitSlop={8}
                                    onPress={() => setAmount((ready / 100).toFixed(2))}
                                    style={{ minHeight: 44, justifyContent: 'center' }}
                                >
                                    <Text variant="bodySm" tone="primary" center>Send everything</Text>
                                </Pressable>
                            ) : null}
                        </Card>
                    )}

                    <DestinationBlock
                        state={data!}
                        editing={editingDestination}
                        setEditing={setEditingDestination}
                        onSaved={(msg) => { setNotice(msg); setProblem(null); refetch(); }}
                        onProblem={setProblem}
                    />

                    <History payouts={data!.recentPayouts} />
                </ScrollView>
            )}

            {/* Confirm restates amount AND destination. An irreversible money
                action must not rest on a number she can no longer see. */}
            {confirming && data?.destination ? (
                <View
                    style={{
                        position: 'absolute', left: 0, right: 0, bottom: 0, top: 0,
                        backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
                    }}
                >
                    <View
                        style={{
                            backgroundColor: t.colors.surface,
                            borderTopLeftRadius: 20, borderTopRightRadius: 20,
                            padding: t.space.lg, gap: t.space.md,
                            paddingBottom: bottomInset + t.space.lg,
                        }}
                    >
                        <Text variant="h2" weight="semi">Send this money?</Text>
                        <ConfirmRow label="Amount" value={money(amountMinor, data.currency)} strong />
                        <ConfirmRow label="To" value={data.destination.accountName} />
                        <ConfirmRow label="Number" value={data.destination.accountNumberMasked} />
                        <ConfirmRow label="Network" value={data.destination.provider} />
                        <Text variant="caption" tone="muted">
                            Mobile Money usually arrives within a few minutes.
                        </Text>
                        <Button
                            label="Yes, send it"
                            fullWidth
                            loading={withdraw.isPending}
                            onPress={send}
                        />
                        <Button
                            label="Not now"
                            variant="secondary"
                            fullWidth
                            disabled={withdraw.isPending}
                            onPress={() => setConfirming(false)}
                        />
                    </View>
                </View>
            ) : null}
        </View>
    );
}

function ConfirmRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    const t = useTheme();
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.lg }}>
            <Text variant="bodySm" tone="muted">{label}</Text>
            <Text variant={strong ? 'body' : 'bodySm'} weight={strong ? 'semi' : 'medium'}>
                {value}
            </Text>
        </View>
    );
}

function Banner({ tone, text }: { tone: 'success' | 'warning' | 'danger'; text: string }) {
    const t = useTheme();
    const color =
        tone === 'success' ? t.colors.primary : tone === 'danger' ? t.colors.danger : t.colors.warning;
    return (
        <View
            style={{
                padding: t.space.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: color,
                backgroundColor: t.colors.surfaceSunken,
            }}
        >
            <Text variant="bodySm">{text}</Text>
        </View>
    );
}

function DestinationBlock({ state, editing, setEditing, onSaved, onProblem }: {
    state: MoneyState;
    editing: boolean;
    setEditing: (v: boolean) => void;
    onSaved: (msg: string) => void;
    onProblem: (msg: string) => void;
}) {
    const t = useTheme();
    const { data: providers } = useMomoProviders(editing);
    const preview = usePreviewDestination();
    const save = useSaveDestination();

    const [provider, setProvider] = useState('');
    const [number, setNumber] = useState('');
    const [resolvedName, setResolvedName] = useState<string | null>(null);

    const chosen = provider || providers?.[0]?.code || '';

    async function check() {
        setResolvedName(null);
        const res = await preview
            .mutateAsync({ accountNumber: number, provider: chosen })
            .catch(() => null);
        setResolvedName(res?.accountName ?? null);
    }

    async function persist() {
        try {
            const res = await save.mutateAsync({
                accountNumber: number,
                provider: chosen,
                accountName: resolvedName ?? undefined,
            });
            setEditing(false);
            setNumber('');
            setResolvedName(null);
            onSaved(
                res.coolingOffHours
                    ? `Saved. For your safety this number can receive money in ${res.coolingOffHours} hours.`
                    : 'Saved. You can withdraw to this number now.',
            );
        } catch (err: any) {
            onProblem(err?.response?.data?.message ?? 'We could not save that number.');
        }
    }

    return (
        <Card padded style={{ gap: t.space.md }}>
            <Text variant="body" weight="semi">Where your money goes</Text>

            {state.destination ? (
                <View>
                    <Text variant="bodySm">
                        {state.destination.accountName} · {state.destination.accountNumberMasked}
                    </Text>
                    <Text variant="caption" tone="muted">
                        {state.destination.provider}
                        {state.destination.usable ? '' : ' · active in 24 hours'}
                    </Text>
                </View>
            ) : (
                <Text variant="bodySm" tone="muted">
                    Not set yet. Add the Mobile Money number you already use.
                </Text>
            )}

            {!editing ? (
                <Button
                    label={state.destination ? 'Change number' : 'Add number'}
                    variant="secondary"
                    fullWidth
                    onPress={() => setEditing(true)}
                />
            ) : (
                <View style={{ gap: t.space.md }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
                        {(providers ?? []).map((p) => {
                            const active = chosen === p.code;
                            return (
                                <Pressable
                                    key={p.code}
                                    onPress={() => { setProvider(p.code); setResolvedName(null); }}
                                    style={{
                                        minHeight: 44,
                                        justifyContent: 'center',
                                        paddingHorizontal: t.space.md,
                                        borderRadius: 10,
                                        borderWidth: 1,
                                        borderColor: active ? t.colors.primary : t.colors.border,
                                        backgroundColor: active ? t.colors.surfaceSunken : 'transparent',
                                    }}
                                >
                                    <Text variant="bodySm" weight={active ? 'semi' : 'regular'}>{p.name}</Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    <Field
                        label="Mobile Money number"
                        value={number}
                        onChangeText={(v: string) => { setNumber(v); setResolvedName(null); }}
                        keyboardType="phone-pad"
                        placeholder="024 123 4567"
                    />

                    {resolvedName ? (
                        <View style={{ padding: t.space.md, borderRadius: 12, backgroundColor: t.colors.surfaceSunken }}>
                            <Text variant="caption" tone="muted">This number belongs to</Text>
                            <Text variant="body" weight="semi">{resolvedName}</Text>
                            <Text variant="caption" tone="muted">Is that you? If not, check the number.</Text>
                        </View>
                    ) : null}

                    <Button
                        label="Check this number"
                        variant="secondary"
                        fullWidth
                        loading={preview.isPending}
                        disabled={number.replace(/\D/g, '').length < 6}
                        onPress={check}
                    />
                    <Button
                        label="Save"
                        fullWidth
                        loading={save.isPending}
                        disabled={number.replace(/\D/g, '').length < 6 || !chosen}
                        onPress={persist}
                    />
                    <Button label="Cancel" variant="secondary" fullWidth onPress={() => setEditing(false)} />
                </View>
            )}

            {state.destination ? (
                <View style={{ flexDirection: 'row', gap: t.space.sm }}>
                    <Ionicons name="shield-checkmark-outline" size={14} color={t.colors.textSubtle} />
                    <Text variant="caption" tone="subtle" style={{ flex: 1 }}>
                        If you change this number it can only receive money after 24 hours, and we
                        will tell you it changed. That protects you if someone gets into your account.
                    </Text>
                </View>
            ) : null}
        </Card>
    );
}

function History({ payouts }: { payouts: MoneyPayout[] }) {
    const t = useTheme();
    if (payouts.length === 0) {
        return (
            <Card padded>
                <Text variant="bodySm" tone="muted">
                    Money you send to yourself will show up here.
                </Text>
            </Card>
        );
    }
    return (
        <Card padded style={{ gap: t.space.sm }}>
            <Text variant="body" weight="semi">Recent withdrawals</Text>
            {payouts.map((p) => (
                <View
                    key={p.id}
                    style={{
                        flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'space-between', gap: t.space.md,
                        paddingVertical: t.space.sm,
                    }}
                >
                    <View style={{ flex: 1 }}>
                        <Text variant="bodySm" weight="medium">{money(p.amountMinor, p.currency)}</Text>
                        <Text variant="caption" tone="muted">
                            {new Date(p.createdAt).toLocaleDateString()}
                            {p.failureReason ? ` · ${p.failureReason}` : ''}
                        </Text>
                    </View>
                    <Badge
                        label={
                            p.status === 'PAID' ? 'Arrived'
                                : p.status === 'FAILED' || p.status === 'CANCELLED' ? 'Did not go'
                                    : 'On the way'
                        }
                        tone={
                            p.status === 'PAID' ? 'success'
                                : p.status === 'FAILED' || p.status === 'CANCELLED' ? 'danger'
                                    : 'warning'
                        }
                    />
                </View>
            ))}
        </Card>
    );
}
