import { expect, test } from '@playwright/test';
import {
  expectAccessible,
  expectNoHorizontalOverflow,
  joinWifi,
  randomPhone,
  seed,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('reconnect state when opened outside the Wi-Fi', async ({ page }) => {
  await page.goto('/connect');
  await expect(page.getByRole('heading', { name: 'Reconnect to the Wi-Fi' })).toBeVisible();
  await expectAccessible(page);
});

test('voucher: welcome → enter code → access being configured → connected (gateway-confirmed)', async ({
  page,
}, info) => {
  const code = seed().codes[info.project.name === 'desktop' ? 0 : 1] as string;
  await joinWifi(page);
  await expect(page.getByRole('heading', { name: 'Get online' })).toBeVisible();
  await expect(page.getByText('Harbour View Lodge')).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'I have a voucher' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your voucher' })).toBeFocused();
  await page.getByLabel('Voucher code').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Switching on your access' })).toBeVisible();
  // The worker applies the policy to the (simulated) gateway and reads it back.
  await expect(page.getByRole('heading', { name: /You['’]re connected/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/day|h .*left/).first()).toBeVisible();
  await expectAccessible(page);
});

test('invalid voucher gives a generic message', async ({ page }) => {
  await joinWifi(page);
  await page.getByRole('button', { name: 'I have a voucher' }).click();
  await page.getByLabel('Voucher code').fill('ZZZZ-ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/That code didn['’]t work/)).toBeVisible();
  await expect(page.getByLabel('Voucher code')).toHaveAttribute('aria-invalid', 'true');
});

test('purchase: plan → details → review → Paystack (simulated) → voucher → connect this device', async ({
  page,
}) => {
  await joinWifi(page);
  await page.getByRole('button', { name: 'Choose a plan' }).click();
  await page.getByRole('button', { name: /Choose Day pass/ }).click();
  await page.getByLabel('Phone number').fill(randomPhone());
  await page.getByLabel('Email for the Paystack receipt').fill('buyer@example.com');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review your purchase' })).toBeVisible();
  for (const term of ['Price', 'Lasts', 'Starts', 'Devices', 'Speed', 'Refunds'])
    await expect(page.getByText(term, { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Pay ₦500.00' }).click();
  // Simulated hosted checkout (stands in for checkout.paystack.com).
  await expect(page.getByText('SIMULATED PAYMENT')).toBeVisible();
  await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
  await expect(page).toHaveURL(/\/checkout\/return\?order=/);
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Show my code' }).click();
  await expect(page.locator('.voucher-code')).toHaveText(
    /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/,
  );
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Connect this device' }).click();
  await expect(page).toHaveURL(/\/connect\?/);
  await expect(page.getByRole('heading', { name: /You['’]re connected/ })).toBeVisible({
    timeout: 30_000,
  });
});

test('payment failure is shown honestly and offers a retry', async ({ page }) => {
  await joinWifi(page);
  await page.getByRole('button', { name: 'Choose a plan' }).click();
  await page.getByRole('button', { name: /Choose Day pass/ }).click();
  await page.getByLabel('Phone number').fill(randomPhone());
  await page.getByLabel('Email for the Paystack receipt').fill('buyer@example.com');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Pay ₦500.00' }).click();
  await page.getByRole('button', { name: 'Simulate failure' }).click();
  await expect(page.getByRole('heading', { name: /Payment didn['’]t go through/ })).toBeVisible();
  await expect(page.getByText('You have not been charged for this attempt.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
});

test('payment page with nothing stored explains what to do', async ({ page }) => {
  await page.goto('/checkout/return');
  await expect(
    page.getByRole('heading', { name: /We can['’]t find your payment on this device/ }),
  ).toBeVisible();
});

test('help and recovery screen is reachable from the portal', async ({ page }) => {
  await joinWifi(page);
  await page.getByRole('button', { name: 'Need help?' }).click();
  await expect(page.getByRole('heading', { name: 'Help and recovery' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+2348000000100' })).toBeVisible();
  await expectAccessible(page);
});
