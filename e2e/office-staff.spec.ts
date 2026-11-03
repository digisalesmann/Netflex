import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoHorizontalOverflow } from './helpers';
import { goTo, signInOwner } from './office';

test('staff and activity: add, roles, reset, disable; every step shows in the activity log', async ({
  page,
  browser,
}, info) => {
  const email = `desk-${info.project.name}-${Date.now().toString(36)}@test.invalid`;
  const name = info.project.name === 'desktop' ? 'Kemi Desk' : 'Tobi Desk';
  await signInOwner(page, info.project.name);

  await goTo(page, 'Staff');
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
  await expect(page.locator('.adm-staff', { hasText: 'You' })).toContainText('Owner');
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  // Add a front-desk staff member.
  await page.getByRole('button', { name: 'Add staff' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Full name').fill(name);
  await dlg.getByLabel('Work email').fill(email);
  const password = await dlg.getByLabel('Temporary password').inputValue();
  expect(password.length).toBeGreaterThanOrEqual(12);
  await dlg.getByRole('button', { name: 'Add staff member' }).click();
  await expect(page.getByRole('heading', { name: 'Staff member added' })).toBeVisible();
  await expect(page.locator('.adm-handover')).toContainText(email);
  await expect(page.locator('.adm-handover')).toContainText(password);
  await page.getByRole('button', { name: 'Done' }).click();

  const row = page.locator('.adm-staff', { hasText: email });
  await expect(row).toContainText('Front desk');
  await expect(row).toContainText('Hasn’t signed in yet');

  // Give, then remove, a second role.
  await row.getByRole('button', { name: 'Give role' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Role' }).click();
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /^Finance/ })
    .click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Covers the evening shift');
  await page.getByRole('dialog').getByRole('button', { name: 'Give role' }).click();
  await expect(row.locator('.adm-role', { hasText: 'Finance' })).toBeVisible();
  await row.getByRole('button', { name: 'Remove Finance' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Shift ended');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove role' }).click();
  await expect(row.locator('.adm-role', { hasText: 'Finance' })).toHaveCount(0);

  // The new person can sign in with the temporary password and is asked to set up two-step.
  const ctx = await browser.newContext(info.project.use);
  const them = await ctx.newPage();
  await them.goto('/admin/sign-in');
  await them.getByLabel('Work email').fill(email);
  await them.getByLabel('Password').fill(password);
  await them.getByRole('button', { name: 'Continue' }).click();
  await expect(them.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  await ctx.close();

  // Reset their sign-in, then disable the account.
  await row.getByRole('button', { name: 'Reset sign-in' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Lost phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in reset' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await row.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Left the job');
  await page.getByRole('dialog').getByRole('button', { name: 'Disable account' }).click();
  await expect(
    page.getByRole('region', { name: 'Disabled' }).locator('.adm-staff', { hasText: email }),
  ).toBeVisible();

  // Activity log tells the story in plain words.
  await goTo(page, 'Activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  const log = page.locator('.adm-log');
  await expect(log.getByText('disabled a staff account').first()).toBeVisible();
  await expect(log.getByText('“Left the job”').first()).toBeVisible();
  await expect(log.getByText('gave a staff role').first()).toBeVisible();
  await expectAccessible(page);
});
