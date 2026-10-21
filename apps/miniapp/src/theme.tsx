import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Light, dark or as the system. The choice is kept on the device; "system"
// follows the phone, which in MAX means the theme of the messenger.

export type ThemeChoice = 'system' | 'light' | 'dark';
type Theme = { choice: ThemeChoice; scheme: 'light' | 'dark'; setChoice: (choice: ThemeChoice) => void; toggle: () => void };

const storageKey = 'domoved-theme';
const ThemeContext = createContext<Theme | null>(null);

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function ThemeProvider({ children }: { children: (scheme: 'light' | 'dark') => ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(stored);
  const [dark, setDark] = useState(systemDark);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  const scheme = choice === 'system' ? (dark ? 'dark' : 'light') : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme === 'dark' ? '#0b0c10' : '#ebedf0');
  }, [scheme]);
  const value = useMemo<Theme>(() => {
    const setChoice = (next: ThemeChoice) => {
      setChoiceState(next);
      try { localStorage.setItem(storageKey, next); } catch { /* the choice lives only in this session */ }
    };
    return { choice, scheme, setChoice, toggle: () => setChoice(scheme === 'dark' ? 'light' : 'dark') };
  }, [choice, scheme]);
  return <ThemeContext.Provider value={value}>{children(scheme)}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme outside ThemeProvider');
  return theme;
}
