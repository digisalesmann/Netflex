import { codeTicket, eyebrow, heading, layout, note, para, type Brand } from './layout.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Short label for logs and the provider dashboard. Never contains secrets. */
  tag: string;
}

/** The one-time code a resident types on the sign-in page. */
export function signInCodeEmail(input: {
  brand: Brand;
  to: string;
  code: string;
  minutes: number;
}): RenderedEmail {
  const { brand, code, minutes } = input;
  const lodge = brand.lodgeName;
  const subject = `${code} is your ${lodge} Wi-Fi sign-in code`;
  const caption = `Expires in ${minutes} minutes · Works once`;
  const html = layout({
    brand,
    title: subject,
    preheader: `Your code is ${code}. It expires in ${minutes} minutes.`,
    reason: `You got this email because someone asked to sign in to ${lodge} Wi-Fi with ${input.to}.`,
    content: [
      eyebrow('Sign-in code'),
      heading('Here’s your code'),
      para(`Enter it on the sign-in page to open your ${lodge} Wi-Fi account.`, { muted: true }),
      codeTicket(code, caption),
      note(
        'Didn’t ask for this?',
        'You can ignore this email. Nobody can sign in without the code. Never share it: the lodge team will never ask for it.',
      ),
    ].join('\n'),
  });
  const text = [
    `Your ${lodge} Wi-Fi sign-in code`,
    '',
    code,
    '',
    `${caption}.`,
    '',
    'Didn’t ask for this? You can ignore this email. Nobody can sign in without the code.',
    'Never share it: the lodge team will never ask for it.',
    '',
    '—',
    `${lodge} Wi-Fi · powered by Netflex`,
    brand.supportEmail ?? '',
    brand.supportPhone ?? '',
    `${brand.webUrl}/contact`,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  return { subject, html, text, tag: 'sign-in-code' };
}
