import { expect, test } from '@playwright/test';
import {
  asNewVisitor,
  expectAccessible,
  expectNoHorizontalOverflow,
  otpFor,
  randomPhone,
} from './helpers';

async function signIn(page: import('@playwright/test').Page) {
  const phone = randomPhone();
  await asNewVisitor(page);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account\/sign-in/);
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  const intl = `+234${phone.slice(1)}`;
  await page.getByLabel('6-digit code').fill(await otpFor(page, intl));
  await page.getByLabel(/Your name/).fill('Ada');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ada' })).toBeVisible();
}

test('sign in with a phone code, then every account page works and is accessible', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByText('You have no active plan.')).toBeVisible();
  await expectAccessible(page);
  for (const [link, heading] of [
    ['Plans', 'Plans'],
    ['Orders', 'Orders and receipts'],
    ['Vouchers', 'Vouchers'],
    ['Help', 'Help'],
    ['Settings', 'Settings'],
  ] as const) {
    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: link, exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
  }
});

test('buy a plan from the account and see the receipt', async ({ page }) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Account' })
    .getByRole('link', { name: 'Plans', exact: true })
    .click();
  await page.getByRole('button', { name: 'Buy Day pass' }).click();
  await page.getByLabel('Email for the Paystack receipt').fill('ada@example.com');
  await page.getByRole('button', { name: 'Pay ₦500.00' }).click();
  await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  await page.goto('/account/orders');
  await page.getByRole('link', { name: 'Receipt' }).first().click();
  await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
  await expect(page.getByText('This is not a tax invoice.', { exact: false })).toBeVisible();
  await expect(page.getByText('₦500.00')).toBeVisible();
  await page.goto('/account');
  await expect(page.getByText('Voucher available — not started')).toBeVisible();
});

test('room plans need authorisation from the property office', async ({ page }) => {
  await signIn(page);
  await page.goto('/account/plans');
  await expect(
    page.getByText(/Register with the property office to buy room or floor plans/),
  ).toBeVisible();
});

test('support request, preferences, data export and sign-out', async ({ page }) => {
  await signIn(page);
  await page.goto('/account/support');
  await page.getByLabel('What is it about?').selectOption('OUTAGE');
  await page.getByLabel('Short summary').fill('No internet in G1');
  await page.getByLabel('Details').fill('Nothing has loaded since 9pm in room G1.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Message sent')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No internet in G1')).toBeVisible();

  await page.goto('/account/settings');
  await expect(page.getByText(/Messages aren['’]t being sent yet/)).toBeVisible();
  await page.getByLabel('Reminder before my plan ends').first().uncheck();
  await page.getByRole('button', { name: 'Save choices' }).click();
  await expect(page.getByText('Notification choices saved.')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toBe('netflex-my-data.json');

  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account\/sign-in/);
});
