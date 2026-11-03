import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoHorizontalOverflow, joinWifi } from './helpers';
import { goTo, seed, signInOwner } from './office';

test('network: equipment status, checks, turn off and on, devices online', async ({
  page,
}, info) => {
  // Someone is online with a seeded voucher, so there's a device to see.
  await joinWifi(page);
  await page.getByRole('button', { name: 'I have a voucher' }).click();
  const codes = (seed() as unknown as { codes: string[] }).codes;
  await page.getByLabel('Voucher code').fill(codes[info.project.name === 'desktop' ? 0 : 1] ?? '');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: /You['’]re connected/ })).toBeVisible({
    timeout: 30_000,
  });

  await signInOwner(page, info.project.name);
  await goTo(page, 'Network');
  await expect(page.getByRole('heading', { name: 'Network', level: 1 })).toBeVisible();
  const gw = page.locator('.adm-gw').first();
  await expect(gw).toContainText('Simulated (test)');
  await expect(page.getByText('Switch a plan on').first()).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  await gw.getByRole('button', { name: 'Check now' }).click();
  await expect(gw.getByText('It answered. Working normally.')).toBeVisible();
  // A network check asks the equipment who is online. (The simulated equipment keeps its list
  // per process, so the count isn't asserted here; phase 6 integration tests cover sessions.)
  await page.getByRole('button', { name: 'Run a network check' }).click();
  await expect(page.getByText(/^Checked\. \d+ devices online/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Online now/ })).toBeVisible();

  await gw.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Router maintenance');
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(gw).toContainText('Turned off');
  await gw.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Maintenance done');
  await page.getByRole('dialog').getByRole('button', { name: 'Turn on' }).click();
  await expect(gw).not.toContainText('Turned off');
});

test('network: add the Omada controller and make a lodge link pairing code', async ({
  page,
}, info) => {
  await signInOwner(page, info.project.name);
  await goTo(page, 'Network');
  await expect(page.getByRole('heading', { name: 'Equipment' })).toBeVisible();
  const add = page.getByRole('button', { name: 'Add Omada controller' });
  // Desktop and phone runs share one database; the first run adds it.
  if (await add.isVisible()) {
    await add.click();
    await page.getByRole('dialog').getByLabel('Equipment (optional)').fill('3× EAP115 v4');
    await page.getByRole('dialog').getByRole('button', { name: 'Add controller' }).click();
  }
  const omada = page.locator('.adm-gw', { hasText: 'TP-Link Omada' });
  await expect(omada).toContainText('Not paired');
  await expect(omada.locator('code')).toContainText(/\/connect\/omada\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: 'Add Omada controller' })).toHaveCount(0);

  await omada.getByRole('button', { name: /Pair (lodge link|again)/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'download it here' })).toHaveAttribute(
    'href',
    '/downloads/lodge-link.zip',
  );
  await dialog.getByRole('button', { name: 'Make a pairing code' }).click();
  await expect(dialog.locator('.adm-pair__code')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(dialog.getByRole('button', { name: 'Copy pairing code' })).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expectNoHorizontalOverflow(page);
  const zip = await page.request.get('/downloads/lodge-link.zip');
  expect(zip.status()).toBe(200);
});
