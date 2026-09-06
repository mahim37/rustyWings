/**
 * Light and dark themes. The choice ("system", "light" or "dark") is kept in
 * localStorage; the effective theme lands on `<html data-theme>` so the CSS
 * can switch its variables, and the canvas and charts read their colours
 * back from those variables so nothing is defined twice.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEMES: { choice: ThemeChoice; label: string }[] = [
  { choice: 'system', label: 'System' },
  { choice: 'light', label: 'Light' },
  { choice: 'dark', label: 'Dark' },
];

export const THEME_KEY = 'rustywings.theme';

export function readTheme(): ThemeChoice {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** Put the effective theme on the document. */
export function applyTheme(choice: ThemeChoice, systemDark: boolean): 'light' | 'dark' {
  const effective = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  document.documentElement.dataset['theme'] = effective;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', effective);
  return effective;
}

/** A `--variable` from the document's computed style, e.g. `#2a78d6`. */
export function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
