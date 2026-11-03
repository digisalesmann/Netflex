import {
  button,
  codeTicket,
  eyebrow,
  heading,
  layout,
  note,
  para,
  receiptLines,
  type Brand,
} from './layout.js';

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

const textFooter = (brand: Brand) =>
  [
    '—',
    `${brand.lodgeName} Wi-Fi · powered by Netflex`,
    brand.supportEmail ?? '',
    brand.supportPhone ?? '',
    `${brand.webUrl}/contact`,
  ]
    .filter(Boolean)
    .join('\n');

/** Payment receipt for a signed-in resident (guests get Paystack's own receipt). */
export function receiptEmail(input: {
  brand: Brand;
  to: string;
  name: string;
  plan: string;
  amount: string;
  reference: string;
  paidAt: string;
  lasts: string;
  starts: string;
}): RenderedEmail {
  const { brand } = input;
  const subject = `Receipt: ${input.plan} at ${brand.lodgeName} (${input.amount})`;
  const web = brand.webUrl.replace(/\/+$/, '');
  const rows: [string, string][] = [
    ['Plan', input.plan],
    ['Lasts', input.lasts],
    ['Starts', input.starts],
    ['Order', input.reference],
    ['Paid', input.paidAt],
  ];
  const html = layout({
    brand,
    title: subject,
    preheader: `Thanks${input.name ? `, ${input.name}` : ''}. Your ${input.plan} is ready to use.`,
    reason: `You got this receipt because you bought Wi-Fi at ${brand.lodgeName} with ${input.to}. Turn receipts off in your account settings.`,
    content: [
      eyebrow('Receipt'),
      heading(`Thanks${input.name ? `, ${input.name}` : ''}. You’re all set.`),
      para(`Your ${input.plan} is ready. Use your code on the Wi-Fi sign-in page to start it.`, {
        muted: true,
      }),
      receiptLines(rows, ['Total paid', input.amount]),
      button('View in your account', `${web}/account/orders`),
      note(
        'Need a refund or help?',
        'Reply to this email or use the Help page. Keep your order number handy.',
      ),
    ].join('\n'),
  });
  const text = [
    `Receipt: ${input.plan} at ${brand.lodgeName}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    `Total paid: ${input.amount}`,
    '',
    `View in your account: ${web}/account/orders`,
    '',
    textFooter(brand),
  ].join('\n');
  return { subject, html, text, tag: 'receipt' };
}

/** Heads-up before a plan runs out. */
export function planEndingEmail(input: {
  brand: Brand;
  to: string;
  name: string;
  plan: string;
  endsAt: string;
  left: string;
}): RenderedEmail {
  const { brand } = input;
  const web = brand.webUrl.replace(/\/+$/, '');
  const subject = `Your ${input.plan} ends ${input.left}`;
  const html = layout({
    brand,
    title: subject,
    preheader: `It ends ${input.endsAt}. Renew now and the new time starts when this one ends.`,
    reason: `You got this because you have a plan at ${brand.lodgeName}. Turn reminders off in your account settings.`,
    content: [
      eyebrow('Reminder'),
      heading(`Your ${input.plan} ends ${input.left}`),
      para(
        `It ends ${input.endsAt}. Renew now and you won’t lose a minute: the new time starts when this one ends.`,
        { muted: true },
      ),
      button('Renew', `${web}/account`),
      note(
        'Not staying?',
        'You can ignore this email. Your plan simply ends; nothing renews by itself.',
      ),
    ].join('\n'),
  });
  const text = [
    `Your ${input.plan} ends ${input.left} (${input.endsAt}).`,
    '',
    `Renew: ${web}/account`,
    'Nothing renews by itself.',
    '',
    textFooter(brand),
  ].join('\n');
  return { subject, html, text, tag: 'plan-ending' };
}

/** Something needs an owner's attention (payments, Wi-Fi equipment, failed jobs). */
export function opsAlertEmail(input: {
  brand: Brand;
  title: string;
  lines: string[];
  actionLabel: string;
  actionPath: string;
}): RenderedEmail {
  const { brand } = input;
  const web = brand.webUrl.replace(/\/+$/, '');
  const subject = `[${brand.lodgeName}] ${input.title}`;
  const html = layout({
    brand,
    title: subject,
    preheader: input.lines[0] ?? input.title,
    reason: 'You got this because you’re an owner. Alerts are sent at most once a day per problem.',
    content: [
      eyebrow('Needs attention'),
      heading(input.title),
      ...input.lines.map((l) => para(l, { muted: true })),
      button(input.actionLabel, `${web}${input.actionPath}`),
    ].join('\n'),
  });
  const text = [
    input.title,
    '',
    ...input.lines,
    '',
    `${input.actionLabel}: ${web}${input.actionPath}`,
  ].join('\n');
  return { subject, html, text, tag: 'ops-alert' };
}
