export type PaletteId = 'ink' | 'ocean' | 'plum' | 'forest' | 'cinnabar';

export interface Palette {
  id: PaletteId;
  name: string;
  note: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  accentSoft: string;
  accentBorder: string;
  accentRgb: string;
  secondary: string;
  secondaryInk: string;
  secondarySoft: string;
  secondaryRgb: string;
}

/** 五套账本配色：主色用于按钮、图表与高亮，副色用于装饰与辅助强调。 */
export const PALETTES: Palette[] = [
  {
    id: 'ink',
    name: '青墨',
    note: '青绿 × 琥珀金',
    accent: '#0e7568',
    accentStrong: '#0b6357',
    accentInk: '#0b6357',
    accentSoft: '#e3f1ed',
    accentBorder: '#cbe5dd',
    accentRgb: '14, 117, 104',
    secondary: '#b7791f',
    secondaryInk: '#8a5a13',
    secondarySoft: '#fbf1dd',
    secondaryRgb: '183, 121, 31',
  },
  {
    id: 'ocean',
    name: '海盐',
    note: '海蓝 × 赤陶橙',
    accent: '#2f6fb0',
    accentStrong: '#255b92',
    accentInk: '#235a94',
    accentSoft: '#e4eef8',
    accentBorder: '#c7dcef',
    accentRgb: '47, 111, 176',
    secondary: '#c2653f',
    secondaryInk: '#9c4f30',
    secondarySoft: '#f8e9e1',
    secondaryRgb: '194, 101, 63',
  },
  {
    id: 'plum',
    name: '紫藤',
    note: '藤紫 × 玫红',
    accent: '#7a4e9e',
    accentStrong: '#684185',
    accentInk: '#653f83',
    accentSoft: '#f0e9f7',
    accentBorder: '#ded0ec',
    accentRgb: '122, 78, 158',
    secondary: '#c05b7a',
    secondaryInk: '#9c4560',
    secondarySoft: '#f8e8ed',
    secondaryRgb: '192, 91, 122',
  },
  {
    id: 'forest',
    name: '松林',
    note: '松绿 × 蜜金色',
    accent: '#4e7a3b',
    accentStrong: '#416632',
    accentInk: '#3e6530',
    accentSoft: '#eaf2e4',
    accentBorder: '#d2e4c5',
    accentRgb: '78, 122, 59',
    secondary: '#b7791f',
    secondaryInk: '#8a5a13',
    secondarySoft: '#fbf1dd',
    secondaryRgb: '183, 121, 31',
  },
  {
    id: 'cinnabar',
    name: '朱砂',
    note: '朱砂红 × 青瓷绿',
    accent: '#b4453a',
    accentStrong: '#98362e',
    accentInk: '#98362e',
    accentSoft: '#f8e7e4',
    accentBorder: '#eccfca',
    accentRgb: '180, 69, 58',
    secondary: '#2f7a6e',
    secondaryInk: '#23645a',
    secondarySoft: '#e4f1ee',
    secondaryRgb: '47, 122, 110',
  },
];

export const DEFAULT_PALETTE: PaletteId = 'ink';
const STORAGE_KEY = 'moneyflow.palette';

export function getPalette(id: string | null | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function getPaletteId(): PaletteId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return PALETTES.some((p) => p.id === stored) ? (stored as PaletteId) : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

/** 把配色写入根节点 CSS 变量，并同步浏览器主题色与图标。 */
export function applyPalette(id: PaletteId = getPaletteId()): Palette {
  const palette = getPalette(id);
  const root = document.documentElement;
  root.dataset.palette = palette.id;
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--accent-strong', palette.accentStrong);
  root.style.setProperty('--accent-ink', palette.accentInk);
  root.style.setProperty('--accent-soft', palette.accentSoft);
  root.style.setProperty('--accent-border', palette.accentBorder);
  root.style.setProperty('--accent-rgb', palette.accentRgb);
  root.style.setProperty('--accent-2', palette.secondary);
  root.style.setProperty('--accent-2-ink', palette.secondaryInk);
  root.style.setProperty('--accent-2-soft', palette.secondarySoft);
  root.style.setProperty('--accent-2-rgb', palette.secondaryRgb);
  root.style.setProperty('--site-accent', palette.accent);

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = palette.accent;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${palette.accent}'/><text x='32' y='44' font-size='36' font-family='system-ui,sans-serif' font-weight='700' text-anchor='middle' fill='white'>¥</text></svg>`;
    icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  return palette;
}

export function setPalette(id: PaletteId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式下不可写时仍按当前会话生效
  }
  applyPalette(id);
}

/** 读取运行时 CSS 变量（图表等 Canvas 场景无法直接使用 var()）。 */
export function cssColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}