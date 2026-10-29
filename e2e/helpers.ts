import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const seed = () =>
  JSON.parse(readFileSync(join(__dirname, '.state/seed.json'), 'utf8')) as {
    codes: string[];
    roomId: string;
    propertySlug: string;
  };

/** WCAG 2.2 AA automated checks: no serious or critical violations allowed. */
export async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

/** No accidental horizontal page overflow (spec §20). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, `page is ${scroll}px wide in a ${width}px viewport`).toBeLessThanOrEqual(width);
}

/** Simulate joining the property Wi-Fi: the simulated gateway redirects to /connect with its identifiers. */
export async function joinWifi(page: Page) {
  await page.goto('/api/v1/dev/fake-gateway/join');
  await expect(page).toHaveURL(/\/connect\?gw=/);
}

/** Read the last simulated SMS code (development-only outbox). */
export async function otpFor(page: Page, phone: string): Promise<string> {
  const r = await page.request.post('/api/v1/dev/otp-outbox', {
    headers: { 'x-netflex-csrf': '1' },
    data: { phone },
  });
  return ((await r.json()) as { data: { code: string } }).data.code;
}

/** Each simulated visitor gets its own client address (as a real load balancer would report). */
export async function asNewVisitor(page: Page) {
  const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
}

export const randomPhone = () => `081${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
