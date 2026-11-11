export type ThemePref = 'auto' | 'light' | 'dark';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem('theme');
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(pref: ThemePref): void {
  const el = document.documentElement;
  if (pref === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', pref);
  try {
    localStorage.setItem('theme', pref);
  } catch {
    /* stockage indisponible : le thème s'applique quand même pour cette session */
  }
}

/** Applique la couleur principale de la série (#rrggbb) et choisit une couleur de texte lisible dessus. */
export function applyAccent(hex: string | null): void {
  const el = document.documentElement;
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    el.style.removeProperty('--accent');
    el.style.removeProperty('--on-accent');
    return;
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  el.style.setProperty('--accent', hex);
  el.style.setProperty('--on-accent', luminance > 0.4 ? '#0b1220' : '#ffffff');
}
