import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Describes the group for screen readers, e.g. "Appearance". */
  label?: string;
}

/**
 * iOS-style segmented control: all choices visible at once, current one filled.
 * Preferred over a picker or a modal for small, mutually exclusive sets — the
 * user sees every option and switching costs a single tap.
 */
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  const t = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        backgroundColor: t.colors.surfaceSunken,
        borderRadius: t.radius.md,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 9,
              borderRadius: t.radius.sm,
              backgroundColor: selected ? t.colors.primary : 'transparent',
              opacity: pressed && !selected ? 0.6 : 1,
            })}
          >
            {opt.icon ? (
              <Ionicons
                name={opt.icon}
                size={15}
                color={selected ? t.colors.onPrimary : t.colors.textMuted}
              />
            ) : null}
            <Text
              variant="caption"
              weight={selected ? 'semi' : 'medium'}
              tone={selected ? 'onPrimary' : 'muted'}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
