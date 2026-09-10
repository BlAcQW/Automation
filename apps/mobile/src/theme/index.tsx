import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { elevation, fonts, motion, palettes, radius, space, type, ThemeColors } from './tokens';

export interface Theme {
  colors: ThemeColors;
  scheme: 'light' | 'dark';
  space: typeof space;
  radius: typeof radius;
  fonts: typeof fonts;
  type: typeof type;
  motion: typeof motion;
  elevation: (level: 1 | 2 | 3) => ReturnType<typeof elevation>;
}

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const theme = useMemo<Theme>(() => {
    const colors = palettes[scheme];
    return {
      colors,
      scheme,
      space,
      radius,
      fonts,
      type,
      motion,
      elevation: (level) => elevation(level, colors.shadow),
    };
  }, [scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export type { ThemeColors } from './tokens';
