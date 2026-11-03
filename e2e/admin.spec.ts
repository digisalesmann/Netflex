import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { asNewVisitor, expectAccessible, expectNoHorizontalOverflow } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { totpAt } = require('../packages/security/dist/index.js') as {
  totpAt: (secret: string, unixSeconds: number) => string;
};

type Seed = {
  owners: Record<string, { email: string; password: string; mfaSecret: string }>;
  managers: Record<string, { email: string; password: string }>;
};
const seed = () => JSON.parse(readFileSync(join(__dirname, '.state/seed.json'), 'utf8')) as Seed;

/** A code from a step this account hasn't used yet (codes are single-use per 30 s step). */
const usedSteps = new Map<string, number>();
async function freshCode(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if ((usedSteps.get(secret) ?? -1) >= step) {
    await new Promise((r) => setTimeout(r, (step + 1) * 30_000 - Date.now() + 200));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.set(secret, step);
  return totpAt(secret, step * 30);
}

async function signInOwner(page: Page, project: string) {
  const o = seed().owners[project];
  await asNewVisitor(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in/);
  await page.getByLabel('Work email').fill(o.email);
  await page.getByLabel('Password').fill(o.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(await freshCode(o.mfaSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening), Ada/ }),
  ).toBeVisible();
}

test('office pages need a staff sign-in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in\?next=%2Fadmin/);
  await expect(page.getByRole('heading', { name: 'Office sign-in' })).toBeVisible();
  await expectAccessible(page);
});

test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
  await asNewVisitor(page);
  await page.goto('/admin/sign-in');
  await page.getByLabel('Work email').fill('nobody@test.invalid');
  await page.getByLabel('Password').fill('not the password at all');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
});

test('owner signs in with password and two-step code and sees the overview', async ({
  page,
}, info) => {
  await signInOwner(page, info.project.name);
  await expect(page.getByText('Online now')).toBeVisible();
  await expect(page.getByText('Sales today')).toBeVisible();
  await expect(page.getByText('Rooms occupied')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest payments' })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  // Sign out from the menu (behind the menu button on phones).
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in/);
});

test('a new manager sets up two-step and replaces the temporary password', async ({
  page,
}, info) => {
  const m = seed().managers[info.project.name];
  await asNewVisitor(page);
  await page.goto('/admin/sign-in');
  await page.getByLabel('Work email').fill(m.email);
  await page.getByLabel('Password').fill(m.password);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const key = (await page.locator('.adm-qr__key code').innerText()).replace(/\s/g, '');
  await page.getByLabel('6-digit code').fill(await freshCode(key));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('Temporary password').fill(m.password);
  await page.getByLabel('New password', { exact: true }).fill('a brand new office passphrase');
  await page.getByLabel('Repeat new password').fill('a brand new office passphrase');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: /Bayo/ })).toBeVisible();
  // A property admin sees the lodge but not finance figures.
  await expect(page.getByText('Rooms occupied')).toBeVisible();
  await expect(page.getByText('Sales today')).toHaveCount(0);
});
