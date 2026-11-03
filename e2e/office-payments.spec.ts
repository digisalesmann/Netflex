import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { asNewVisitor, expectAccessible, expectNoHorizontalOverflow, randomPhone } from './helpers';
import { goTo, seed, signInOwner, signInStaff } from './office';

const CSRF = { 'x-netflex-csrf': '1' };

/** A guest buys the Day pass and pays (simulated Paystack). Returns the order reference. */
async function paidOrder(page: Page): Promise<string> {
  await asNewVisitor(page);
  const plans = (await (
    await page.request.get('/api/v1/catalog/properties/e2e-lodge/plans')
  ).json()) as {
    data: { name: string; planVersionId: string }[];
  };
  const day = plans.data.find((p) => p.name === 'Day pass');
  if (!day) throw new Error('Day pass missing from the e2e catalog');
  const order = (await (
    await page.request.post('/api/v1/orders', {
      headers: { ...CSRF, 'idempotency-key': randomUUID() },
      data: {
        planVersionId: day.planVersionId,
        target: { scope: 'INDIVIDUAL' },
        customerPhone: randomPhone(),
      },
    })
  ).json()) as { data: { orderId: string; reference: string; accessToken?: string } };
  const token = order.data.accessToken;
  const checkout = (await (
    await page.request.post(`/api/v1/orders/${order.data.orderId}/checkout`, {
      headers: {
        ...CSRF,
        'idempotency-key': randomUUID(),
        ...(token ? { 'x-order-token': token } : {}),
      },
      data: { email: 'buyer@example.com' },
    })
  ).json()) as { data: { checkoutUrl: string } };
  await page.goto(checkout.data.checkoutUrl);
  await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
  await expect(page).toHaveURL(/\/checkout\/return/);
  return order.data.reference;
}

test('payments: find, check with Paystack, ask for a refund, a second person approves', async ({
  page,
  browser,
}, info) => {
  const reference = await paidOrder(page);

  await signInOwner(page, info.project.name);
  await goTo(page, 'Payments');
  await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible();
  await page.getByLabel('Find a payment by reference').fill(reference);
  await page.getByLabel('Find a payment by reference').press('Enter');
  const row = page.getByRole('link', { name: new RegExp(reference) });
  await expect(row).toContainText('Paid');
  await expect(row).toContainText('Day pass');
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  await row.click();
  await expect(page.getByRole('heading', { name: '₦500', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Check with Paystack' }).click();
  await expect(page.getByText('Already settled. Nothing changed.')).toBeVisible();

  // Ask for a part refund.
  await page.getByRole('button', { name: 'Refund' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Amount (₦)').fill('900');
  await dlg.getByLabel('Reason').fill('Outage on Tuesday');
  await dlg.getByRole('button', { name: 'Request refund' }).click();
  await expect(dlg.getByText(/more than the ₦500 that can be refunded/)).toBeVisible();
  await dlg.getByLabel('Amount (₦)').fill('200');
  await dlg.getByRole('button', { name: 'Request refund' }).click();
  await expect(page.locator('.adm-refunds')).toContainText('Waiting for approval');
  // The person who asked can't approve.
  await expect(page.getByText('Waiting for another staff member to approve.')).toBeVisible();
  await expectAccessible(page);

  // Finance approves from the refunds queue.
  const ctx = await browser.newContext(info.project.use);
  const fin = await ctx.newPage();
  await signInStaff(fin, seed().finance[info.project.name], 'Femi');
  await goTo(fin, 'Payments');
  await fin.getByRole('link', { name: /^Refunds/ }).click();
  const waiting = fin.locator('.adm-refunds li', { hasText: reference });
  await expect(waiting).toContainText('Outage on Tuesday');
  await waiting.getByRole('button', { name: 'Approve' }).click();
  await fin.getByRole('dialog').getByRole('button', { name: 'Approve ₦200 refund' }).click();
  await expect(fin.locator('.adm-refunds li', { hasText: reference })).not.toContainText(
    'Waiting for approval',
  );
  await expect(fin.locator('.adm-refunds li', { hasText: reference })).toContainText(
    'approved by Femi Finance',
  );
  await expectAccessible(fin);
  await ctx.close();
});
