# Accessibility audit, 3 November 2026

Standard: WCAG 2.2 level AA.

## Automated checks

- **On every test run.** The end-to-end tests run axe (WCAG 2.0, 2.1 and 2.2 A/AA rules) on 27 screens, on both a desktop and a phone screen size. These cover the public site, resident accounts, the Wi-Fi sign-in page and every office section. Any serious or critical problem fails the build. They also check that no page scrolls sideways.
- **This audit.** A stricter axe scan, including moderate and minor issues and best practices, was run on the live site at both screen sizes. Pages scanned: home, plans, how it works, FAQ, coverage, contact, terms, privacy, refunds, resident sign-in, Wi-Fi sign-in (`/connect`) and office sign-in.

**Result:** all clean except one moderate issue on Plans (desktop). The comparison table and its section had the same name for screen readers. It's fixed: the table is now named "Comparison table".

## Other checks

| Area                                                                                 | How it was checked                                                           | Result |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------ |
| Keyboard only: every link, button, form, dialog and dropdown can be reached and used | Some end-to-end tests use only the keyboard; the rest by hand while building | Pass   |
| Visible focus ring on every control                                                  | Shared `:focus-visible` style; by hand                                       | Pass   |
| "Skip to content" link on every page                                                 | Root layout                                                                  | Pass   |
| Dialogs (confirmations, office panels) trap focus and close with Esc                 | Built on the browser's native `<dialog>`                                     | Pass   |
| Custom dropdowns: arrow keys, Home/End, typing to jump, Esc                          | ARIA combobox/listbox pattern; by hand                                       | Pass   |
| Text contrast at least 4.5:1, including faded and disabled text                      | axe on every screen (earlier failures fixed)                                 | Pass   |
| Form errors announced to screen readers                                              | `role="alert"` on error messages                                             | Pass   |
| Reduced motion respected                                                             | `prefers-reduced-motion` rules in the styles                                 | Pass   |
| Content reflows at narrow widths (as at 200% zoom)                                   | Phone-size tests at 390 px with no sideways scroll                           | Pass   |
| Touch targets at least 24×24 px                                                      | axe `target-size` rule (WCAG 2.2)                                            | Pass   |
| Emails: plain-text version, readable without images, clear link words                | Template tests                                                               | Pass   |

## Known limits

- Not yet tested with a screen reader by a person who uses one every day. Worth doing once after launch.
- The Wi-Fi sign-in page will open inside phones' built-in captive-portal windows, which have limited accessibility support. That gets tested on site with the real equipment.
