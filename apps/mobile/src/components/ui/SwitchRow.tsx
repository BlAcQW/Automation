import { Switch, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="medium">
          {label}
        </Text>
        {description ? (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: t.colors.surfaceSunken, true: t.colors.primary }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={t.colors.surfaceSunken}
      />
    </View>
  );
}
