import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { colors, tokensToCss, type ColorScheme } from './tokens.js';

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe.each<ColorScheme>(['light', 'dark'])('%s scheme meets WCAG 2.2 AA', (scheme) => {
  const c = colors[scheme];

  it.each([
    ['text on bg', c.text, c.bg],
    ['text on bgSubtle', c.text, c.bgSubtle],
    ['muted text on bg', c.textMuted, c.bg],
    ['muted text on bgSubtle', c.textMuted, c.bgSubtle],
    ['accent (links) on bg', c.accent, c.bg],
    ['onAccent on accent (buttons)', c.onAccent, c.accent],
    ['success on bg', c.success, c.bg],
    ['warning on bg', c.warning, c.bg],
    ['danger on bg', c.danger, c.bg],
    ['info on bg', c.info, c.bg],
  ])('%s ≥ 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([
    ['focus ring on bg', c.focus, c.bg],
    ['input border on bg', c.borderStrong, c.bg],
  ])('%s ≥ 3:1 (non-text)', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('tokensToCss', () => {
  const css = tokensToCss();
  it('emits every colour for both schemes and respects reduced motion', () => {
    for (const key of Object.keys(colors.light)) {
      const name = `--nf-color-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      expect(css.split(`${name}:`).length - 1).toBe(3); // light, OS-dark, forced-dark
    }
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain("[data-theme='dark']");
  });
  it('defines a 44px touch target and a visible focus width', () => {
    expect(css).toContain('--nf-layout-touch-target: 44px');
    expect(css).toContain('--nf-focus-width: 2px');
  });
});
