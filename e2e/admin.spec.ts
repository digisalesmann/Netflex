import { expect, test } from '@playwright/test';
import { asNewVisitor, expectAccessible, expectNoHorizontalOverflow } from './helpers';
import { freshCode, seed, signInOwner } from './office';

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
  await page
    .getByRole('dialog', { name: 'Sign out of the office?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
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
  await expect(page.getByRole('button', { name: 'Copy key' })).toBeVisible();
  const key = (await page.locator('.adm-qr__row code').innerText()).replace(/\s/g, '');
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
