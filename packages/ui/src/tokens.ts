/**
 * NetFlex design tokens (spec §19). One source for marketing, captive portal,
 * tenant and admin interfaces. Restrained palette, hairline dividers, small radii,
 * system fonts (no web-font download on weak captive connections).
 * Brand decision recorded in docs/decisions/adr-0006-design-tokens.md.
 */

export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  /** Page background. */
  bg: string;
  /** Subtle alternate band for full-width sections and table header rows. */
  bgSubtle: string;
  /** Primary text. */
  text: string;
  /** Secondary text: captions, helper text, table metadata. */
  textMuted: string;
  /** Hairline dividers and input borders. */
  border: string;
  /** Stronger border for inputs on focus-less state. */
  borderStrong: string;
  /** Single restrained accent: links, primary action, focus ring. */
  accent: string;
  /** Text on accent-filled buttons. */
  onAccent: string;
  /** Inline status colours (used as text + small dot, never as large fills). */
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Focus ring. */
  focus: string;
}

export const colors: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: '#fbfaf8',
    bgSubtle: '#f2f0ec',
    text: '#1a1a18',
    textMuted: '#5c5a55',
    border: '#e2dfd8',
    borderStrong: '#8a867d',
    accent: '#0b5d57',
    onAccent: '#ffffff',
    success: '#1d6b35',
    warning: '#8a5300',
    danger: '#b0261d',
    info: '#1f4f8f',
    focus: '#0b5d57',
  },
  dark: {
    bg: '#121211',
    bgSubtle: '#1b1b19',
    text: '#eeece7',
    textMuted: '#a8a59e',
    border: '#2e2d2a',
    borderStrong: '#77746c',
    accent: '#5cc2b6',
    onAccent: '#0b1615',
    success: '#6cc98a',
    warning: '#e3a64b',
    danger: '#f08077',
    info: '#86b1ea',
    focus: '#5cc2b6',
  },
};

export const typography = {
  fontSans:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  /** Fluid type scale (rem). Minimums keep 16px body text on 320px screens. */
  size: {
    xs: '0.8125rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: 'clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)',
    '2xl': 'clamp(1.5rem, 1.25rem + 1.2vw, 2.125rem)',
    '3xl': 'clamp(2rem, 1.5rem + 2.4vw, 3.25rem)',
  },
  weight: { regular: '400', medium: '500', semibold: '600' },
  leading: { tight: '1.15', snug: '1.35', normal: '1.55' },
  tracking: { tight: '-0.015em', normal: '0', wide: '0.04em' },
} as const;

/** 4px base spacing scale. */
export const space = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.5rem',
  6: '2rem',
  7: '3rem',
  8: '4rem',
  9: '6rem',
} as const;

/** Small radii only — no oversized rounded containers. */
export const radius = { none: '0', sm: '2px', md: '4px', lg: '6px', pill: '999px' } as const;

export const border = { hairline: '1px', strong: '2px' } as const;

/** Shadows used sparingly: only for overlays (menus, dialogs). */
export const shadow = {
  overlay: '0 8px 24px rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.08)',
} as const;

export const focus = { width: '2px', offset: '2px' } as const;

export const layout = {
  /** Readable line length for editorial text. */
  measure: '66ch',
  contentMax: '72rem',
  gutter: '1rem',
  /** Minimum touch target (spec §20). */
  touchTarget: '44px',
} as const;

export const motion = {
  fast: '120ms',
  base: '180ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const breakpoints = { sm: 390, md: 768, lg: 1024, xl: 1440 } as const;

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function colorVars(c: ColorTokens): string {
  return Object.entries(c)
    .map(([k, v]) => `  --nf-color-${kebab(k)}: ${v};`)
    .join('\n');
}

function groupVars(prefix: string, group: Record<string, string>): string {
  return Object.entries(group)
    .map(([k, v]) => `  --nf-${prefix}-${kebab(k)}: ${v};`)
    .join('\n');
}

/**
 * Generate the CSS custom properties. Dark mode follows the OS unless the page
 * sets data-theme explicitly.
 */
export function tokensToCss(): string {
  const statics = [
    `  --nf-font-sans: ${typography.fontSans};`,
    `  --nf-font-mono: ${typography.fontMono};`,
    groupVars('text', typography.size),
    groupVars('weight', typography.weight),
    groupVars('leading', typography.leading),
    groupVars('tracking', typography.tracking),
    groupVars('space', Object.fromEntries(Object.entries(space).map(([k, v]) => [k, v]))),
    groupVars('radius', radius),
    groupVars('border', border),
    groupVars('shadow', shadow),
    groupVars('focus', focus),
    groupVars('layout', layout),
    groupVars('motion', motion),
  ].join('\n');

  return `/* Generated from packages/ui/src/tokens.ts — do not edit by hand. */
:root {
  color-scheme: light dark;
${statics}
${colorVars(colors.light)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${colorVars(colors.dark).replace(/^/gm, '  ')}
  }
}
:root[data-theme='dark'] {
${colorVars(colors.dark)}
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --nf-motion-fast: 0ms;
    --nf-motion-base: 0ms;
  }
}
`;
}
