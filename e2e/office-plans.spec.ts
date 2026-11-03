import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoHorizontalOverflow } from './helpers';
import { goTo, signInOwner } from './office';

/** Choose an option from one of our custom dropdowns inside a panel. */
async function pick(page: Page, label: string, option: string | RegExp) {
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: label }).click();
  await dlg.getByRole('option', { name: option }).click();
}

test('plans and vouchers: create, reprice, pause; make, find, suspend, replace and cancel codes', async ({
  page,
}, info) => {
  const P = info.project.name === 'desktop' ? 'Desk' : 'Phone';
  await signInOwner(page, info.project.name);

  // ---- Plans
  await goTo(page, 'Plans');
  await expect(page.getByRole('heading', { name: 'Plans', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Day pass/ })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'New plan' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(`${P} night`);
  await dlg.getByLabel('Price (₦)').fill('300');
  await dlg.getByLabel('Lasts').fill('12');
  await pick(page, 'Unit', 'Hours');
  await dlg.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('heading', { name: `${P} night`, level: 1 })).toBeVisible();
  await expect(page.getByText('On sale', { exact: true })).toBeVisible();
  await expect(page.locator('.receipt__amt').first()).toHaveText('₦300.00');

  // Change the price: a new version, put on sale straight away.
  await page.getByRole('button', { name: 'Change price or terms' }).click();
  await page.getByRole('dialog').getByLabel('Price (₦)').fill('350');
  await page.getByRole('dialog').getByRole('button', { name: 'Save new version' }).click();
  await expect(page.locator('.receipt__amt').first()).toHaveText('₦350.00');
  await expect(page.locator('.adm-timeline li')).toHaveCount(2);
  await expectAccessible(page);

  // Pause, then it shows as paused in the list.
  await page.getByRole('button', { name: 'Pause sales' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Testing');
  await page.getByRole('dialog').getByRole('button', { name: 'Pause sales' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Plans', exact: true }).first().click();
  await expect(page.getByRole('link', { name: new RegExp(`${P} night`) })).toContainText('Paused');

  // ---- Vouchers
  await goTo(page, 'Vouchers');
  await page.getByRole('button', { name: 'Make vouchers' }).click();
  await pick(page, 'Plan', /Day pass/);
  await page.getByRole('dialog').getByLabel('How many').fill('2');
  await page.getByRole('dialog').getByLabel('Note').fill('Paid cash at desk');
  await page.getByRole('dialog').getByRole('button', { name: 'Make codes' }).click();
  await expect(page.getByRole('heading', { name: 'Your new codes' })).toBeVisible();
  const codes = await page.locator('.adm-codes__list code').allInnerTexts();
  expect(codes).toHaveLength(2);
  const [first = '', second = ''] = codes;
  for (const c of codes)
    expect(c).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Done' }).click();

  // Only the last 4 characters are ever shown again; find one by them.
  const last4 = first.slice(-4);
  await page.getByLabel('Find a code by its last 4 characters').fill(last4);
  await page.getByLabel('Find a code by its last 4 characters').press('Enter');
  const row = page.locator('.adm-voucher', { hasText: last4 });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Not used yet');
  await expect(row).toContainText('Paid at desk');
  await expect(page.getByText(first)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await row.getByRole('button', { name: 'Suspend' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Checking');
  await page.getByRole('dialog').getByRole('button', { name: 'Suspend' }).click();
  await expect(row).toContainText('Suspended');

  await row.getByRole('button', { name: 'Replace code' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Guest lost the slip');
  await page.getByRole('dialog').getByRole('button', { name: 'Replace code' }).click();
  await expect(page.getByRole('heading', { name: 'The new code' })).toBeVisible();
  const replacement = await page.locator('.adm-codes__list code').innerText();
  expect(replacement).not.toBe(codes[0]);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('Cancelled');

  // Cancel the other new code for good.
  await page.getByLabel('Find a code by its last 4 characters').fill(second.slice(-4));
  await page.getByLabel('Find a code by its last 4 characters').press('Enter');
  const other = page.locator('.adm-voucher', { hasText: second.slice(-4) });
  await other.getByRole('button', { name: 'Cancel code' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Not needed');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel code' }).click();
  await expect(other).toContainText('Cancelled');
  await expect(other.getByRole('button')).toHaveCount(0);
});
