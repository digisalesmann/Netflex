/**
 * Netflex email layout. Table-based with inline styles so it renders the same in
 * Gmail, Outlook, Apple Mail and Yahoo. Every dynamic value goes through `esc()`.
 *
 * Structure: hidden preheader → logo → white sheet (content) → footer (lodge,
 * contacts, links, why you got this email).
 */

export const C = {
  canvas: '#f2f0ec',
  sheet: '#ffffff',
  text: '#1a1a18',
  muted: '#5c5a55',
  faint: '#8a867d',
  border: '#e2dfd8',
  tint: '#f7f6f3',
  accent: '#0b5d57',
} as const;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Escape text for HTML element and attribute content. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface Brand {
  /** e.g. "ND Lodge" */
  lodgeName: string;
  /** Public website, used for the logo and footer links. No trailing slash. */
  webUrl: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
}

// ------------------------------------------------------------------ blocks

export const eyebrow = (text: string) =>
  `<p class="nf-eyebrow" style="margin:0 0 12px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${C.accent};">${esc(text)}</p>`;

export const heading = (text: string) =>
  `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.5px;color:${C.text};">${esc(text)}</h1>`;

/** A paragraph. Pass pre-escaped HTML only via `html`. */
export const para = (text: string, opts: { muted?: boolean; small?: boolean } = {}) =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:${opts.small ? 14 : 16}px;line-height:${opts.small ? 22 : 26}px;color:${opts.muted ? C.muted : C.text};">${esc(text)}</p>`;

/** Large one-time code on a tinted ticket with a dashed tear line. */
export const codeTicket = (code: string, caption: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td class="nf-tint" align="center" bgcolor="${C.tint}" style="background:${C.tint};border-radius:14px 14px 0 0;padding:28px 16px 22px;">
      <div class="nf-code" style="font-family:${MONO};font-size:38px;line-height:44px;font-weight:700;letter-spacing:12px;color:${C.text};padding-left:12px;">${esc(code)}</div>
    </td>
  </tr>
  <tr>
    <td class="nf-tint" bgcolor="${C.tint}" style="background:${C.tint};padding:0 20px;font-size:0;line-height:0;">
      <div class="nf-tear" style="border-top:2px dashed ${C.border};height:0;line-height:0;font-size:0;">&nbsp;</div>
    </td>
  </tr>
  <tr>
    <td class="nf-tint" align="center" bgcolor="${C.tint}" style="background:${C.tint};border-radius:0 0 14px 14px;padding:14px 16px 16px;font-family:${FONT};font-size:13px;line-height:18px;color:${C.muted};">${esc(caption)}</td>
  </tr>
</table>`;

/** Quiet note with an accent rule on the left (security tips, small print). */
export const note = (title: string, body: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
  <tr>
    <td width="3" bgcolor="${C.accent}" style="background:${C.accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding:2px 0 2px 16px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">
      <strong style="color:${C.text};font-weight:600;">${esc(title)}</strong><br>${esc(body)}
    </td>
  </tr>
</table>`;

/** Bulletproof button (a padded table cell, so it works in Outlook). */
export const button = (label: string, href: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td bgcolor="${C.text}" style="background:${C.text};border-radius:999px;">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a>
    </td>
  </tr>
</table>`;

/** Receipt-style lines on a tinted ticket; the last row can be a bold total. */
export const receiptLines = (rows: [string, string][], total?: [string, string]) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td class="nf-tint" bgcolor="${C.tint}" style="background:${C.tint};border-radius:14px;padding:18px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${rows
          .map(
            ([k, v]) => `<tr>
          <td style="padding:5px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">${esc(k)}</td>
          <td align="right" style="padding:5px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};">${esc(v)}</td>
        </tr>`,
          )
          .join('')}
        ${
          total
            ? `<tr><td colspan="2" style="padding:8px 0 0;font-size:0;line-height:0;"><div class="nf-tear" style="border-top:2px dashed ${C.border};height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>
        <tr>
          <td style="padding:12px 0 0;font-family:${MONO};font-size:16px;line-height:22px;font-weight:700;color:${C.text};">${esc(total[0])}</td>
          <td align="right" style="padding:12px 0 0;font-family:${MONO};font-size:16px;line-height:22px;font-weight:700;color:${C.text};">${esc(total[1])}</td>
        </tr>`
            : ''
        }
      </table>
    </td>
  </tr>
</table>`;

export const divider = () =>
  `<div style="border-top:1px solid ${C.border};height:0;line-height:0;font-size:0;margin:24px 0;">&nbsp;</div>`;

// ------------------------------------------------------------------ page

const link = (label: string, href: string) =>
  `<a href="${esc(href)}" style="color:${C.muted};text-decoration:none;font-weight:600;">${esc(label)}</a>`;

/**
 * Wrap content blocks in the full email document.
 * @param reason one sentence: why the reader got this email.
 */
export function layout(opts: {
  brand: Brand;
  title: string;
  preheader: string;
  content: string;
  reason: string;
}): string {
  const { brand } = opts;
  const web = brand.webUrl.replace(/\/+$/, '');
  const contacts = [
    brand.supportEmail ? link(brand.supportEmail, `mailto:${brand.supportEmail}`) : '',
    brand.supportPhone
      ? link(brand.supportPhone, `tel:${brand.supportPhone.replace(/\s+/g, '')}`)
      : '',
  ]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  // Pads the preheader so inbox previews don't pull in body text.
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60);

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(opts.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media (max-width:620px) {
    .nf-sheet { padding:32px 24px !important; border-radius:0 !important; }
    .nf-pad { padding-left:24px !important; padding-right:24px !important; }
    .nf-code { font-size:32px !important; letter-spacing:8px !important; padding-left:8px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .nf-canvas { background:#121211 !important; }
    .nf-sheet { background:#1b1b19 !important; }
    .nf-sheet h1, .nf-sheet strong, .nf-code { color:#eeece7 !important; }
    .nf-sheet p, .nf-sheet td { color:#c9c6bf !important; }
    .nf-tint { background:#242320 !important; }
    .nf-logo { filter:invert(1); }
    .nf-sheet p.nf-eyebrow { color:#5cc2b6 !important; }
    .nf-tear { border-top-color:#3a3935 !important; }
    .nf-foot strong { color:#eeece7 !important; }
    .nf-foot, .nf-foot p, .nf-foot a { color:#a8a59e !important; }
  }
</style>
</head>
<body class="nf-canvas" style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">${esc(opts.preheader)}${filler}</div>
<table role="presentation" class="nf-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};">
  <tr>
    <td align="center" style="padding:40px 0 48px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td class="nf-pad" style="padding:0 8px 24px;">
            <a href="${esc(web)}" style="text-decoration:none;">
              <img class="nf-logo" src="${esc(web)}/brand/netflex-mark.png" width="33" height="28" alt="" style="vertical-align:middle;">
              <img class="nf-logo" src="${esc(web)}/brand/netflex-wordmark.png" width="92" height="20" alt="Netflex" style="vertical-align:middle;margin-left:6px;">
            </a>
          </td>
        </tr>
        <tr>
          <td class="nf-sheet" bgcolor="${C.sheet}" style="background:${C.sheet};border-radius:20px;padding:44px 40px 36px;">
            ${opts.content}
          </td>
        </tr>
        <tr>
          <td class="nf-pad nf-foot" style="padding:28px 8px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.faint};">
            <p style="margin:0 0 6px;color:${C.muted};"><strong style="color:${C.text};font-weight:600;">${esc(brand.lodgeName)} Wi-Fi</strong> · powered by Netflex</p>
            ${contacts ? `<p style="margin:0 0 14px;">${contacts}</p>` : ''}
            <p style="margin:0 0 14px;">${link('Help', `${web}/contact`)} &nbsp;·&nbsp; ${link('Your account', `${web}/account`)} &nbsp;·&nbsp; ${link('Privacy', `${web}/legal/privacy`)} &nbsp;·&nbsp; ${link('Terms', `${web}/legal/terms`)}</p>
            <p style="margin:0;">${esc(opts.reason)}</p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}
