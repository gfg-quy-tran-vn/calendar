'use client';

import { useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  // The layout's inline script has already set data-theme; this component is client-only (ssr: false).
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // storage unavailable: the choice just won't persist
    }
    setTheme(next);
  }

  const label = theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode';
  return (
    <button className="icon theme-toggle" onClick={toggle} title={label} aria-label={label}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
