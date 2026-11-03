/** Questions and answers shown on the FAQ page (and a selection on the home page). */
export const FAQ: [string, string][] = [
  [
    'What is a voucher code?',
    'A 12-character code (like ABCD-EFGH-JKMN) that unlocks a plan you bought or were given. It works only at this property. Keep it private: anyone with the code can use your access.',
  ],
  [
    'When does my time start?',
    'Each plan says so before you pay: either when payment is confirmed, when you first enter the code, or when you first connect. Unused codes also have a "use by" date.',
  ],
  [
    'How many devices can I use?',
    'Each plan shows a device limit and how many can be online at once. To swap devices, free a slot from your account (a few times per day) or ask the property office.',
  ],
  [
    'My phone was refused after I changed something.',
    'Some phones use a private, changing Wi-Fi address. Turn off "private Wi-Fi address" (iPhone) or "randomized MAC" (Android) for this network, then reconnect.',
  ],
  [
    'I paid but I am not connected yet.',
    'After payment we confirm it with Paystack and then switch on your access. This usually takes a moment. Use "check payment" on the order page. If it still says pending, contact support with your order reference. Never pay twice.',
  ],
  [
    'I lost my voucher code.',
    'If you bought it signed in, you can retrieve it from the order page until you first use it. Otherwise contact support: the code can be cancelled and reissued.',
  ],
  [
    'Can I share a room or floor plan?',
    'Yes, with the residents the plan buyer adds. Only people who live in that room or on that floor can be added, up to the plan limit.',
  ],
  [
    'Do I need an account?',
    'Not for a personal plan: a phone number for your receipt is enough. Room and floor plans, renewals and device management need a sign-in with your phone number.',
  ],
  [
    'Is the speed guaranteed?',
    'No. The connection is shared and delivered by satellite. Speeds vary with demand, weather and where you are in the building.',
  ],
  [
    'Can I get a refund?',
    'See the refund and cancellation policy. In short: unused plans can usually be refunded; plans that have started are decided case by case.',
  ],
  [
    'How do I report an outage?',
    'Use the help page or your account. Tell us your room and what you see. If you can, include the time it started.',
  ],
];

/** The questions a new visitor most often has; shown on the home page. */
export const HOME_FAQ = [
  'When does my time start?',
  'How many devices can I use?',
  'I paid but I am not connected yet.',
  'Do I need an account?',
  'Is the speed guaranteed?',
].map((q) => {
  const hit = FAQ.find(([question]) => question === q);
  if (!hit) throw new Error(`HOME_FAQ: no FAQ entry for "${q}"`);
  return hit;
});

/** Topics for the FAQ page. Every FAQ entry must belong to exactly one. */
export const FAQ_TOPICS = [
  {
    id: 'plans',
    label: 'Plans and time',
    short: 'Plans',
    questions: [
      'When does my time start?',
      'Can I share a room or floor plan?',
      'Do I need an account?',
    ],
  },
  {
    id: 'payments',
    label: 'Payments and vouchers',
    short: 'Payments',
    questions: [
      'What is a voucher code?',
      'I paid but I am not connected yet.',
      'I lost my voucher code.',
      'Can I get a refund?',
    ],
  },
  {
    id: 'devices',
    label: 'Devices',
    short: 'Devices',
    questions: ['How many devices can I use?', 'My phone was refused after I changed something.'],
  },
  {
    id: 'connection',
    label: 'Connection and help',
    short: 'Connection',
    questions: ['Is the speed guaranteed?', 'How do I report an outage?'],
  },
].map((t) => ({
  ...t,
  items: t.questions.map((q) => {
    const hit = FAQ.find(([question]) => question === q);
    if (!hit) throw new Error(`FAQ_TOPICS: no FAQ entry for "${q}"`);
    return hit;
  }),
}));

const grouped = new Set(FAQ_TOPICS.flatMap((t) => t.questions));
const missing = FAQ.filter(([q]) => !grouped.has(q)).map(([q]) => q);
if (missing.length) throw new Error(`FAQ_TOPICS: not in any topic: ${missing.join('; ')}`);

/** Stable anchor for a question, e.g. "#do-i-need-an-account". */
export const faqId = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
