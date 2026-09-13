import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

/** What the user picked in Settings — not necessarily what's on screen. */
export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeModeValue {
  /** The stored preference. */
  mode: ThemeMode;
  /** The palette actually in use once 'system' is resolved. */
  scheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'bookly.themeMode';

const ThemeContext = createContext<Theme | undefined>(undefined);
const ThemeModeContext = createContext<ThemeModeValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Live OS setting. Tracked even when the user has forced light/dark, so
  // switching back to 'system' applies immediately.
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Restore the saved choice. Until this resolves the app follows the system,
  // which is both the default and the common case.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!active) return;
        if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    // Apply immediately; persistence is best-effort so a storage failure
    // never blocks the UI from responding to the tap.
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme = mode === 'system' ? systemScheme : mode;

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

  const modeValue = useMemo<ThemeModeValue>(() => ({ mode, scheme, setMode }), [mode, scheme, setMode]);

  return (
    <ThemeModeContext.Provider value={modeValue}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemeModeContext.Provider>
  );
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/** Read or change the appearance preference (Settings → Appearance). */
export function useThemeMode(): ThemeModeValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider');
  return ctx;
}

export type { ThemeColors } from './tokens';
