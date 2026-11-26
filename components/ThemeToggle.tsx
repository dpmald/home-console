'use client';
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme(defaultTheme: Theme = 'light'): [Theme, () => void, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    let saved = defaultTheme;
    try {
      const stored = localStorage.getItem('hc_theme');
      if (stored === 'light' || stored === 'dark') saved = stored;
    } catch { /* The display theme is available without device storage. */ }
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, [defaultTheme]);

  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('hc_theme', next); } catch { /* Applied for this visit. */ }
  };

  return [theme, () => apply(theme === 'light' ? 'dark' : 'light'), apply];
}

export function ThemeToggle({ defaultTheme = 'light' }: { defaultTheme?: Theme }) {
  const [theme, toggle] = useTheme(defaultTheme);
  return <ThemeButton theme={theme} onToggle={toggle} />;
}

export function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="hw-btn"
      onClick={onToggle}
      title={theme === 'light' ? 'Switch to Dark mode' : 'Switch to Light mode'}
      aria-label={theme === 'light' ? 'Switch to Dark mode' : 'Switch to Light mode'}
      style={{
        width: 48,
        height: 48,
        padding: 0,
        borderRadius: 14,
        color: 'var(--text-secondary)',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
        {theme === 'light' ? 'dark_mode' : 'light_mode'}
      </span>
    </button>
  );
}
