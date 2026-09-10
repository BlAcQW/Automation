import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';

interface DateTimeFieldProps {
  label: string;
  mode: 'date' | 'time';
  value: string; // "HH:MM" for time, "YYYY-MM-DD" for date
  onChange: (value: string) => void;
  placeholder?: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDate(value: string, mode: 'date' | 'time'): Date {
  const now = new Date();
  if (mode === 'time' && /^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    now.setHours(h, m, 0, 0);
    return now;
  }
  if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, mo, d] = value.split('-').map(Number);
    return new Date(y, mo - 1, d);
  }
  return now;
}

function fromDate(d: Date, mode: 'date' | 'time'): string {
  if (mode === 'time') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DateTimeField({ label, mode, value, onChange, placeholder }: DateTimeFieldProps) {
  const t = useTheme();
  const [show, setShow] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="caption" weight="semi" tone="muted">
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={() => setShow(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          backgroundColor: t.colors.surfaceSunken,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          paddingHorizontal: t.space.md,
          paddingVertical: 13,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name={mode === 'time' ? 'time-outline' : 'calendar-outline'} size={18} color={t.colors.textMuted} />
        <Text variant="body" tone={value ? 'default' : 'subtle'}>
          {value || placeholder || (mode === 'time' ? 'Select time' : 'Select date')}
        </Text>
      </Pressable>

      {show ? (
        <DateTimePicker
          value={toDate(value, mode)}
          mode={mode}
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => {
            // Android fires once then closes; iOS stays until dismissed.
            if (Platform.OS !== 'ios') setShow(false);
            if (event.type === 'set' && selected) onChange(fromDate(selected, mode));
          }}
        />
      ) : null}
    </View>
  );
}
