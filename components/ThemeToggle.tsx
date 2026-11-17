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
    <button
      type="button"
      className="hw-btn"
      onClick={toggle}
      title={theme === 'light' ? 'Switch to Dark mode' : 'Switch to Light mode'}
      aria-label={theme === 'light' ? 'Switch to Dark mode' : 'Switch to Light mode'}
      style={{
        width: 38,
        height: 38,
        padding: 0,
        borderRadius: 12,
        color: 'var(--muted)',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {theme === 'light' ? 'dark_mode' : 'light_mode'}
      </span>
    </button>
  );
}
