#!/usr/bin/env node
// Live check against the REAL Paystack test environment (sk_test_ keys only).
//
//   npm run build
//   node --env-file=.env scripts/paystack-sandbox-check.mjs init you@example.com
//     → prints a Paystack checkout URL and reference; pay there with a Paystack TEST card
//   node --env-file=.env scripts/paystack-sandbox-check.mjs verify <reference>
//     → asks Paystack for the transaction and checks amount/currency/status
//
// Results go to stdout for pasting into docs/test-results. The key is never printed.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PaystackProvider } = require('../packages/payments/dist/index.js');

const key = process.env.PAYSTACK_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) {
  console.error(
    'PAYSTACK_SECRET_KEY must be a TEST key (sk_test_...) for this check. Live keys are refused.',
  );
  process.exit(1);
}
const provider = new PaystackProvider(
  key,
  process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
);
const [cmd, arg] = process.argv.slice(2);
const AMOUNT = 10000n; // ₦100.00

if (cmd === 'init') {
  const email = arg ?? 'sandbox-check@example.com';
  const reference = `NFX-SANDBOX-${Date.now().toString(36).toUpperCase()}`;
  const r = await provider.initialize({
    reference,
    amountMinor: AMOUNT,
    currency: 'NGN',
    email,
    callbackUrl: `${process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000'}/checkout/return`,
    metadata: { purpose: 'netflex-sandbox-check' },
  });
  console.log(
    JSON.stringify(
      {
        step: 'init',
        ok: true,
        reference: r.providerReference,
        checkoutUrl: r.checkoutUrl,
        amountMinor: AMOUNT.toString(),
      },
      null,
      2,
    ),
  );
  console.log('\nOpen the checkout URL, pay with a Paystack test card, then run:');
  console.log(
    `  node --env-file=.env scripts/paystack-sandbox-check.mjs verify ${r.providerReference}`,
  );
} else if (cmd === 'verify' && arg) {
  const v = await provider.verify(arg);
  const checks = {
    status: v.status === 'success',
    amount: v.amountMinor === AMOUNT,
    currency: v.currency === 'NGN',
    reference: v.reference === arg,
  };
  console.log(
    JSON.stringify(
      {
        step: 'verify',
        reference: v.reference,
        status: v.rawStatus,
        amountMinor: v.amountMinor.toString(),
        currency: v.currency,
        paidAt: v.paidAt,
        checks,
        allPassed: Object.values(checks).every(Boolean),
      },
      null,
      2,
    ),
  );
  process.exit(Object.values(checks).every(Boolean) ? 0 : 2);
} else {
  console.error('usage: paystack-sandbox-check.mjs init [email] | verify <reference>');
  process.exit(1);
}
