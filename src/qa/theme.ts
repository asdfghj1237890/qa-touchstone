// ── QA Touchstone — theme system ───────────────────────────────────────────
// Three "directions" the user can compare live. Each is a cohesive dark
// developer-tool theme: palette + radius + default UI font. Applied as CSS
// custom properties on the app root so everything reacts instantly.

export {};

interface ThemeDirection {
  name: string;
  blurb: string;
  uiFont: string;
  accent: string;
  vars: Record<string, string>;
}

interface ThemeOptions {
  direction: string;
  accent: string;
  density: string;
  uiFont: string;
}

const DIRECTIONS: Record<string, ThemeDirection> = {
  graphite: {
    name: 'Graphite',
    blurb: 'Cool slate · electric blue · crisp IDE',
    uiFont: 'sans',
    accent: '#4d9fff',
    vars: {
      '--bg':        '#15181c',
      '--bg-1':      '#1a1e23',
      '--bg-2':      '#21262d',
      '--bg-3':      '#2a3037',
      '--border':    '#272d34',
      '--border-2':  '#39424b',
      '--text':      '#e6edf3',
      '--text-dim':  '#97a3ae',
      '--text-faint':'#626d77',
      '--accent-contrast': '#05121f',
      '--radius':    '8px',
      '--radius-lg': '12px',
    },
  },
  phosphor: {
    name: 'Phosphor',
    blurb: 'Near-black · phosphor green · terminal',
    uiFont: 'mono',
    accent: '#46d27a',
    vars: {
      '--bg':        '#0b0e0c',
      '--bg-1':      '#10140f',
      '--bg-2':      '#161c16',
      '--bg-3':      '#1e261d',
      '--border':    '#1f271e',
      '--border-2':  '#303c2d',
      '--text':      '#d7e8d9',
      '--text-dim':  '#86a088',
      '--text-faint':'#566655',
      '--accent-contrast': '#06140b',
      '--radius':    '4px',
      '--radius-lg': '5px',
    },
  },
  indigo: {
    name: 'Indigo',
    blurb: 'Deep indigo · violet · friendly modern',
    uiFont: 'sans',
    accent: '#9182ff',
    vars: {
      '--bg':        '#131320',
      '--bg-1':      '#191926',
      '--bg-2':      '#212133',
      '--bg-3':      '#2c2c43',
      '--border':    '#28283d',
      '--border-2':  '#3b3b59',
      '--text':      '#e9e9f6',
      '--text-dim':  '#a6a6c4',
      '--text-faint':'#6f6f90',
      '--accent-contrast': '#0b0920',
      '--radius':    '12px',
      '--radius-lg': '16px',
    },
  },
};

const ACCENTS: Record<string, string> = {
  blue:   '#4d9fff',
  green:  '#46d27a',
  violet: '#9182ff',
  amber:  '#f0a35e',
  cyan:   '#3ed0d0',
};

const FONTS: Record<string, string> = {
  sans: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
  mono: "'Google Sans Code', ui-monospace, 'SF Mono', monospace",
};

// Density → row heights + base spacing scale.
const DENSITY: Record<string, Record<string, string>> = {
  compact:     { '--row': '30px', '--gap': '8px',  '--pad': '12px', '--fs': '13px',   '--ctrl': '32px' },
  comfortable: { '--row': '38px', '--gap': '12px', '--pad': '18px', '--fs': '13.5px', '--ctrl': '38px' },
};

// HTTP method accent color (kept consistent across directions for muscle memory).
function methodColor(method: string): string {
  const m = (window.QA?.METHOD_META || {})[method];
  const hue = m ? m.hue : 220;
  return `oklch(0.74 0.15 ${hue})`;
}

// Status code → semantic color.
function statusColor(code: number): string {
  if (code >= 500) return 'oklch(0.68 0.18 18)';   // red
  if (code >= 400) return 'oklch(0.78 0.15 70)';   // amber
  if (code >= 300) return 'oklch(0.74 0.13 230)';  // blue
  if (code >= 200) return 'oklch(0.76 0.15 150)';  // green
  return 'oklch(0.7 0 0)';
}

function applyTheme(el: HTMLElement | null, { direction, accent, density, uiFont }: ThemeOptions): void {
  if (!el) return;
  const dir = DIRECTIONS[direction] || DIRECTIONS.graphite;
  const dens = DENSITY[density] || DENSITY.comfortable;
  const acc = (!accent || accent === 'auto') ? dir.accent
            : (accent[0] === '#' ? accent : (ACCENTS[accent] || dir.accent));
  const font = uiFont === 'auto' ? dir.uiFont : uiFont;

  Object.entries(dir.vars).forEach(([k, v]) => el.style.setProperty(k, v));
  Object.entries(dens).forEach(([k, v]) => el.style.setProperty(k, v));
  el.style.setProperty('--accent', acc);
  el.style.setProperty('--accent-soft', acc + '22');
  el.style.setProperty('--accent-line', acc + '55');
  el.style.setProperty('--font-ui', FONTS[font] || FONTS.sans);
  el.style.setProperty('--font-mono', FONTS.mono);
}

window.QATheme = { DIRECTIONS, ACCENTS, FONTS, DENSITY, methodColor, statusColor, applyTheme };
