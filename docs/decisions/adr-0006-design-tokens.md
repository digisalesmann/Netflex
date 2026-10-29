# ADR-0006: Design tokens and visual language

- Status: Accepted (Phase 1). Brand colours are a proposal until the owner supplies or approves brand assets (A21).
- Date: 2026-10-29

## Context

The repository had no brand assets. The spec (§19, §20) asks for a premium, restrained, card-free interface shared by marketing, captive portal, tenant and admin; WCAG 2.2 AA where practicable; fast loading on weak captive connections.

## Decision

- Single source: `packages/ui/src/tokens.ts`, compiled to CSS custom properties (`--nf-*`) in `packages/ui/dist/tokens.css`.
- Palette: warm neutrals plus one deep-teal accent (`#0b5d57` light / `#5cc2b6` dark). Status colours are used as text and small dots only, never as large fills.
- Light and dark schemes: OS preference by default; `data-theme="light|dark"` overrides.
- **System font stack, no web fonts**, to avoid font downloads on captive portals and slow links.
- Small radii (2–6px), hairline borders, a single overlay shadow for menus/dialogs only. No card components.
- 4px spacing scale; fluid type scale with 16px minimum body text; 44px minimum touch target; 2px focus ring with 2px offset; reduced-motion support.

## Evidence

`packages/ui/src/tokens.test.ts` checks every text/background pair against WCAG AA (4.5:1 text, 3:1 non-text) in both schemes. All 24 checks pass.

## Consequences

- Components must use tokens, not raw colours (to be enforced by lint in Phase 7).
- If the owner provides a brand, only `tokens.ts` changes; contrast tests guard the replacement.
