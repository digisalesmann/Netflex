import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoHorizontalOverflow } from './helpers';

const PAGES = [
  ['/', 'Connect, choose a plan, get online.'],
  ['/how-it-works', 'How it works'],
  ['/plans', 'Plans and pricing'],
  ['/coverage', 'Property and coverage'],
  ['/faq', 'Frequently asked questions'],
  ['/contact', 'Contact and support'],
  ['/legal/privacy', 'Privacy policy'],
  ['/legal/terms', 'Terms of service'],
  ['/legal/refunds', 'Refunds and cancellations'],
] as const;

for (const [path, heading] of PAGES) {
  test(`public page ${path} renders, is accessible and has one h1`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
  });
}

test('plans page shows real catalog data with full pre-purchase terms', async ({ page }) => {
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: /Day pass/ })).toBeVisible();
  await expect(page.getByText('₦500.00').first()).toBeVisible();
  await expect(
    page.getByText('Time starts when you first enter your code.', { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText(/not guaranteed/i).first()).toBeVisible();
  await expect(page.getByText(/Full refund before first use/).first()).toBeVisible();
});

test('legal pages say they are drafts until reviewed; copy makes no forbidden promises', async ({
  page,
}) => {
  await page.goto('/legal/terms');
  await expect(page.getByText('Draft pending legal review')).toBeVisible();
  for (const path of ['/', '/how-it-works', '/plans', '/coverage', '/faq']) {
    await page.goto(path);
    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).not.toMatch(
      /uninterrupted service guaranteed|guaranteed speed|100% uptime|unlimited speed|testimonial/,
    );
  }
});

test('mobile navigation menu works with the keyboard', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile layout only');
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'FAQ' }).click();
  await expect(page).toHaveURL(/\/faq$/);
});

test('no horizontal overflow at every required width', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'widths set explicitly');
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/plans', '/contact', '/legal/privacy']) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    }
  }
});

test('search engines are kept out of private pages', async ({ page }) => {
  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toMatch(/Disallow: \/account/);
  expect(robots).toMatch(/Disallow: \/connect/);
  await page.goto('/connect');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
