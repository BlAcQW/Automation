import { ActivityIndicator, FlatList, View } from 'react-native';
import { useTheme } from '@/theme';
import { useTemplates } from '@/api/hooks';
import { MessageTemplate } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Badge, EmptyState } from '@/components/ui';

function TemplateRow({ item }: { item: MessageTemplate }) {
  const t = useTheme();
  return (
    <Card style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Text variant="body" weight="semi" numberOfLines={1} style={{ flex: 1 }}>
          {item.name}
        </Text>
        <Badge label={item.isApproved ? 'Approved' : 'Pending'} tone={item.isApproved ? 'success' : 'warning'} />
      </View>
      <Text variant="caption" tone="muted">
        {(item.purpose ?? '').replace(/_/g, ' ')} · {item.language}
        {item.variableCount ? ` · ${item.variableCount} variables` : ''}
      </Text>
    </Card>
  );
}

export default function TemplatesScreen() {
  const t = useTheme();
  const { data, isLoading } = useTemplates();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title="Message templates" />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <TemplateRow item={item} />}
          contentContainerStyle={
            (data ?? []).length === 0 ? { flex: 1 } : { padding: t.space.lg, gap: t.space.md }
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="No templates yet"
              subtitle="Register Meta-approved templates from the web dashboard to send messages outside the 24-hour window."
            />
          }
        />
      )}
    </View>
  );
}
