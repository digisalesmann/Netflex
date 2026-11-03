import { expect, test } from '@playwright/test';
import { asNewVisitor, expectAccessible, expectNoHorizontalOverflow, randomPhone } from './helpers';
import { goTo, signInOwner } from './office';

test('support and settings: a guest writes in, staff take it and resolve it; lodge email changes', async ({
  page,
}, info) => {
  const subject = `No signal in room ${info.project.name === 'desktop' ? '7' : '9'} ${Date.now() % 10000}`;
  // A guest sends a message (as the Help page does).
  await asNewVisitor(page);
  const r = await page.request.post('/api/v1/support/tickets', {
    headers: { 'x-netflex-csrf': '1' },
    data: {
      propertySlug: 'e2e-lodge',
      category: 'CONNECTIVITY',
      subject,
      body: 'Nothing connects since this morning.\nTried twice.',
      contactPhone: randomPhone(),
    },
  });
  expect(r.status()).toBe(201);

  await signInOwner(page, info.project.name);
  await goTo(page, 'Support');
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();
  const t = page.locator('.adm-ticket', { hasText: subject });
  await expect(t).toContainText('New');
  await expect(t).toContainText('Can’t connect or slow');
  await expect(t.getByRole('link', { name: /^Call \+234/ })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  await t.getByRole('button', { name: 'Take it' }).click();
  await expect(t).toContainText('Being handled');
  await expect(t).toContainText('you’re handling it');
  await t.getByRole('button', { name: 'Resolved' }).click();
  await expect(page.locator('.adm-ticket', { hasText: subject })).toHaveCount(0);
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(page.locator('.adm-ticket', { hasText: subject })).toContainText('Resolved');

  // Settings: save wakes up on change, and the public catalog updates.
  await goTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  const email = page.getByLabel('Email for residents');
  const before = await email.inputValue();
  await email.fill(`desk-${info.project.name}@lodge.test`);
  await save.click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(save).toBeDisabled();
  const pub = await (await page.request.get('/api/v1/catalog/properties/e2e-lodge')).json();
  expect(pub.data.supportEmail).toBe(`desk-${info.project.name}@lodge.test`);
  await expect(page.locator('.adm-devices')).toContainText('This device');
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  await email.fill(before);
  await save.click();
  await expect(save).toBeDisabled();
});
