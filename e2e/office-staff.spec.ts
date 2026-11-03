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
  await expect(page.locator('.adm-table__row', { hasText: 'You' })).toContainText('Owner');
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

  // The list shows them; open their page to manage access.
  const listRow = page.locator('.adm-table__row', { hasText: email });
  await expect(listRow).toContainText('Front desk');
  await expect(listRow).toContainText('Not set up');
  await expect(listRow).toContainText('Never');
  await listRow.click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  // Give, then remove, a second role.
  await page.getByRole('button', { name: 'Give role' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Role' }).click();
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /^Finance/ })
    .click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Covers the evening shift');
  await page.getByRole('dialog').getByRole('button', { name: 'Give role' }).click();
  const access = page.locator('.adm-rolelist');
  await expect(access).toContainText('Finance');
  await page.getByRole('button', { name: 'Remove Finance' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Shift ended');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove role' }).click();
  await expect(access).not.toContainText('Finance');

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
  await page.getByRole('button', { name: 'Reset sign-in' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Lost phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in reset' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Left the job');
  await page.getByRole('dialog').getByRole('button', { name: 'Disable account' }).click();
  await expect(page.locator('.adm-profile')).toContainText('Disabled');
  await expect(page.getByRole('button', { name: 'Reset sign-in' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Staff', exact: true }).first().click();
  await page
    .getByRole('navigation', { name: 'Filter by role' })
    .getByRole('link', { name: /Disabled/ })
    .click();
  await expect(page.locator('.adm-table__row', { hasText: email })).toBeVisible();

  // Activity log tells the story in plain words, filterable, with details on demand.
  await goTo(page, 'Activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  const feed = page.locator('.adm-feed').first();
  await expect(feed.getByText('disabled a staff account').first()).toBeVisible();
  await expect(feed.getByText('“Left the job”').first()).toBeVisible();
  await expectAccessible(page);

  await page
    .getByRole('navigation', { name: 'Filter by kind' })
    .getByRole('link', { name: 'Payments' })
    .click();
  await expect(page).toHaveURL(/cat=money/);
  await expect(page.getByText('disabled a staff account')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Filter by kind' })
    .getByRole('link', { name: 'Staff & settings' })
    .click();
  const item = page.locator('.adm-feed__item', { hasText: 'disabled a staff account' }).first();
  await expect(item).toBeVisible();
  await item.locator('summary').click();
  await expect(item.getByRole('link', { name: 'Open person' })).toBeVisible();
  await expect(item).toContainText('staff.disabled');

  // Only what one person did.
  await page.getByRole('combobox', { name: /Person/ }).click();
  await page.getByRole('option', { name: 'Ada Office' }).first().click();
  await expect(page).toHaveURL(/who=/);
  await expect(page.locator('.adm-feed__item').first()).toContainText('Ada Office');
  await expectNoHorizontalOverflow(page);
});
