import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

// Deterministic pastel-on-dark accent from the name, so each customer keeps a
// stable colour without a stored avatar.
const ACCENTS = ['#0E9F6E', '#2563EB', '#7C3AED', '#DB2777', '#D97706', '#0891B2', '#DC2626'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  useTheme();
  const bg = ACCENTS[hash(name || '?') % ACCENTS.length];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text weight="bold" style={{ color: '#FFFFFF', fontSize: size * 0.36 }}>
        {initials(name)}
      </Text>
    </View>
  );
}
