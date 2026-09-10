import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = useTheme();

  const map: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: t.colors.surfaceSunken, fg: t.colors.textMuted },
    primary: { bg: t.colors.primarySoft, fg: t.colors.primaryText },
    success: { bg: t.colors.successSoft, fg: t.colors.success },
    warning: { bg: t.colors.warningSoft, fg: t.colors.warning },
    danger: { bg: t.colors.dangerSoft, fg: t.colors.danger },
    info: { bg: t.colors.infoSoft, fg: t.colors.info },
  };
  const c = map[tone];

  return (
    <View
      style={{
        backgroundColor: c.bg,
        paddingHorizontal: t.space.sm,
        paddingVertical: 3,
        borderRadius: t.radius.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="caption" weight="semi" style={{ color: c.fg }}>
        {label}
      </Text>
    </View>
  );
}
