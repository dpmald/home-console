'use client';
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme(defaultTheme: Theme = 'light'): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const saved = (localStorage.getItem('hc_theme') as Theme | null) ?? defaultTheme;
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, [defaultTheme]);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('hc_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return [theme, toggle];
}

export function ThemeToggle({ defaultTheme = 'light' }: { defaultTheme?: Theme }) {
  const [theme, toggle] = useTheme(defaultTheme);
  return (
    <button className="btn sm" onClick={toggle} title="Switch between Light and Dark mode">
      {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}
