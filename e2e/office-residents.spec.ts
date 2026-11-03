import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoHorizontalOverflow, randomEmail } from './helpers';
import { goTo, signInOwner } from './office';

test('rooms and residents: add rooms, onboard, give rights, move, move out', async ({
  page,
}, info) => {
  // Parallel-safe labels: each project adds its own rooms.
  const p = info.project.name === 'desktop' ? 'D' : 'M';
  const email = randomEmail();
  await signInOwner(page, info.project.name);

  // Rooms: the seeded floor, then add two more rooms to it.
  await goTo(page, 'Rooms');
  await expect(page.getByRole('heading', { name: 'Rooms', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add rooms' }).first().click();
  await page.getByLabel('Rooms').fill(`${p}1, ${p}2`);
  await page.getByRole('dialog').getByRole('button', { name: 'Add rooms' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.adm-room__label', { hasText: `${p}2` })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  // Residents: onboard into the first new room.
  await goTo(page, 'Residents');
  await page.getByRole('button', { name: 'Add resident' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Full name').fill(`Chidi ${p}`);
  await dlg.getByLabel('Email').fill(email);
  await dlg.getByRole('combobox', { name: 'Room' }).click();
  await dlg.getByRole('option', { name: `Room ${p}1`, exact: true }).click();
  await expect(dlg.getByRole('listbox')).toBeHidden();
  await expect(dlg.getByRole('combobox', { name: 'Room' })).toHaveText(`Room ${p}1`);
  await dlg.getByRole('button', { name: 'Add resident' }).click();
  await expect(page.getByRole('heading', { name: `Chidi ${p}`, level: 1 })).toBeVisible();
  await expect(page.getByText(`Room ${p}1 · Ground`)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expectAccessible(page);

  // Buying rights for the room.
  await page.getByRole('button', { name: 'Give buying rights' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Room lead');
  await page.getByRole('dialog').getByRole('button', { name: 'Give rights' }).click();
  await expect(page.locator('.adm-list').getByText(`Room ${p}1`)).toBeVisible();

  // Move to the second room: room rights for the old room end.
  await page.getByRole('button', { name: 'Move room' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'New room' }).click();
  await page
    .getByRole('dialog')
    .getByRole('option', { name: `Room ${p}2`, exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Swapped rooms');
  await page.getByRole('dialog').getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText(`Room ${p}2 · Ground`)).toBeVisible();
  await expect(page.locator('.adm-timeline li')).toHaveCount(2);

  // Shows up on the residents list and the room tile.
  await goTo(page, 'Residents');
  await page.getByLabel('Search residents').fill(email);
  await page.getByLabel('Search residents').press('Enter');
  await expect(page.getByRole('link', { name: new RegExp(`Chidi ${p}`) })).toBeVisible();
  await goTo(page, 'Rooms');
  await expect(page.getByRole('link', { name: `Chidi ${p}` })).toBeVisible();

  // Move out.
  await page.getByRole('link', { name: `Chidi ${p}` }).click();
  await page.getByRole('button', { name: 'Record move-out' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Lease ended');
  await page.getByRole('dialog').getByRole('button', { name: 'Record move-out' }).click();
  await expect(page.getByText('Moved out', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move room' })).toHaveCount(0);
  await expect(page.getByText('None yet.')).toBeVisible();
});
