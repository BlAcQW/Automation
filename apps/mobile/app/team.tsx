import { useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, View } from 'react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/auth/context';
import { useAddTeamMember, useTeam, useUpdateTeamMember } from '@/api/hooks';
import { TeamMember } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Badge, Avatar, Field, Button } from '@/components/ui';

function MemberRow({ item, canManage }: { item: TeamMember; canManage: boolean }) {
  const t = useTheme();
  const update = useUpdateTeamMember();
  const isOwner = item.role === 'OWNER';

  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
      <Avatar name={item.name} size={40} />
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="semi" numberOfLines={1}>
          {item.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {item.email}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Badge label={isOwner ? 'Owner' : 'Staff'} tone={isOwner ? 'primary' : 'neutral'} />
        {canManage && !isOwner ? (
          <Switch
            value={item.isActive}
            onValueChange={(v) => update.mutate({ id: item.id, isActive: v })}
            trackColor={{ false: t.colors.surfaceSunken, true: t.colors.primary }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={t.colors.surfaceSunken}
          />
        ) : (
          <Badge label={item.isActive ? 'Active' : 'Off'} tone={item.isActive ? 'success' : 'neutral'} />
        )}
      </View>
    </Card>
  );
}

export default function TeamScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const canManage = user?.role === 'OWNER';
  const { data, isLoading } = useTeam();
  const add = useAddTeamMember();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onAdd() {
    setError(null);
    setOk(false);
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError('Enter a name, email, and a password of at least 8 characters.');
      return;
    }
    try {
      await add.mutateAsync({ name: name.trim(), email: email.trim(), password });
      setName('');
      setEmail('');
      setPassword('');
      setOk(true);
    } catch (e) {
      setError('Could not add. That email may already be in use.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title="Team" />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}>
          {(data ?? []).map((m) => (
            <MemberRow key={m.id} item={m} canManage={canManage} />
          ))}

          {canManage ? (
            <Card padded style={{ gap: t.space.lg, marginTop: t.space.sm }}>
              <Text variant="bodySm" weight="semi">
                Add a team member
              </Text>
              <Field label="Name" value={name} onChangeText={setName} />
              <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              <Field label="Temporary password" value={password} onChangeText={setPassword} secureTextEntry hint="At least 8 characters" />
              {error ? (
                <Text variant="caption" tone="danger">
                  {error}
                </Text>
              ) : null}
              {ok ? (
                <Text variant="caption" tone="success">
                  Team member added.
                </Text>
              ) : null}
              <Button label="Add member" fullWidth loading={add.isPending} onPress={onAdd} />
            </Card>
          ) : (
            <Text variant="caption" tone="subtle" center>
              Only the owner can add team members.
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}
