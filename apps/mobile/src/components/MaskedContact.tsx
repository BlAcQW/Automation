import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';
import { useRevealContact } from '@/api/hooks';

export type RevealScope = 'conversation' | 'booking' | 'order';

interface MaskedContactProps {
  /** Value exactly as the server sent it — already masked where required. */
  value?: string | null;
  /** The server's verdict. Never inferred from the string; the API owns this. */
  masked?: boolean;
  scope: RevealScope;
  recordId: string;
  /** Called with the real value once revealed, e.g. to then open WhatsApp. */
  onRevealed?: (phone: string) => void;
}

/**
 * A customer contact shown masked to staff, with a one-tap reveal.
 *
 * Mirrors the web component. The reveal is deliberately visible and labelled
 * as recorded: a silent audit trail that people discover later feels like a
 * trap, while a stated one actually discourages idle curiosity.
 */
export function MaskedContact({ value, masked, scope, recordId, onRevealed }: MaskedContactProps) {
  const t = useTheme();
  const reveal = useRevealContact();
  const [shown, setShown] = useState<string | null>(null);

  if (!value) return null;

  async function onPress() {
    const res = await reveal.mutateAsync({ scope, id: recordId }).catch(() => null);
    if (res?.customerPhone) {
      setShown(res.customerPhone);
      onRevealed?.(res.customerPhone);
    }
  }

  if (!masked || shown) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text variant="bodySm" weight="medium">
          {shown ?? value}
        </Text>
        {shown ? (
          <Text variant="caption" tone="subtle">
            logged
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={reveal.isPending}
      hitSlop={8}
      accessibilityLabel="Show full contact details"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Text variant="bodySm" weight="medium">
        {value}
      </Text>
      {reveal.isPending ? (
        <ActivityIndicator size="small" color={t.colors.primary} />
      ) : (
        <Ionicons name="eye-outline" size={15} color={t.colors.primary} />
      )}
    </Pressable>
  );
}
