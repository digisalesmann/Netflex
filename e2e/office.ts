import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { asNewVisitor } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { totpAt } = require('../packages/security/dist/index.js') as {
  totpAt: (secret: string, unixSeconds: number) => string;
};

export type Seed = {
  owners: Record<string, { email: string; password: string; mfaSecret: string }>;
  managers: Record<string, { email: string; password: string }>;
};
export const seed = () =>
  JSON.parse(readFileSync(join(__dirname, '.state/seed.json'), 'utf8')) as Seed;

/** A code from a step this account hasn't used yet (codes are single-use per 30 s step). */
const usedSteps = new Map<string, number>();
export async function freshCode(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if ((usedSteps.get(secret) ?? -1) >= step) {
    await new Promise((r) => setTimeout(r, (step + 1) * 30_000 - Date.now() + 200));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.set(secret, step);
  return totpAt(secret, step * 30);
}

export async function signInOwner(page: Page, project: string) {
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

/** Open an office section from the menu (behind the menu button on phones). */
export async function goTo(page: Page, section: string) {
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation', { name: 'Office' })
    .getByRole('link', { name: section })
    .click();
}
