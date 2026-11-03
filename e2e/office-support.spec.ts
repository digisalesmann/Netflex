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

  // Settings: change the lodge email, see it on the public catalog, then put it back.
  await goTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const email = page.getByLabel('Email for residents');
  const before = await email.inputValue();
  await email.fill(`desk-${info.project.name}@lodge.test`);
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const pub = await (await page.request.get('/api/v1/catalog/properties/e2e-lodge')).json();
  expect(pub.data.supportEmail).toBe(`desk-${info.project.name}@lodge.test`);
  await expectAccessible(page);
  await email.fill(before);
  await page.getByRole('button', { name: /Save details|Saved/ }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
});
