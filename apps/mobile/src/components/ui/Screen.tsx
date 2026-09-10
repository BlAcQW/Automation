import { View, ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

interface ScreenProps {
  children: React.ReactNode;
  padded?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
}

// Themed, safe-area-aware page container.
export function Screen({ children, padded = false, edges = ['top'], style }: ScreenProps) {
  const t = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={[{ flex: 1, ...(padded ? { padding: t.space.lg } : null) }, style]}>{children}</View>
    </SafeAreaView>
  );
}
