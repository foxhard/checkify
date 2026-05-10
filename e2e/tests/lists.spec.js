import { test, expect } from '../fixtures.js';

async function createAndSave(page, title, item) {
  await page.locator('#list-title').fill(title);
  await page.locator('.node-label').first().click();
  await page.keyboard.type(item);
  await page.locator('#btn-save').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');
}

// TC-13: Lists panel — switch between saved checklists
test('lists panel shows saved checklists and switching loads the selected one', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/checkify/app/');
  await createAndSave(page, 'List A', 'Item A');

  await page.locator('#btn-new').click();
  await expect(page.locator('#mode-badge')).toHaveText('EDITING');

  await createAndSave(page, 'List B', 'Item B');

  // Open lists panel
  await page.locator('#btn-lists').click();
  await expect(page.locator('#lists-panel')).not.toHaveClass(/hidden/);

  const titles = page.locator('.list-item-title');
  await expect(titles.filter({ hasText: 'List A' })).toHaveCount(1);
  await expect(titles.filter({ hasText: 'List B' })).toHaveCount(1);

  // Switch to List A
  await titles.filter({ hasText: 'List A' }).click();
  await expect(page.locator('#list-title')).toHaveText('List A');
  await expect(page.locator('.node-label').first()).toHaveText('Item A');
});

// TC-14: Lists panel — delete a checklist
test('deleting a checklist from the lists panel removes it permanently', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/checkify/app/');
  await createAndSave(page, 'Keep Me', 'Keep item');

  await page.locator('#btn-new').click();
  await expect(page.locator('#mode-badge')).toHaveText('EDITING');

  await createAndSave(page, 'Delete Me', 'Delete item');

  await page.locator('#btn-lists').click();
  await expect(page.locator('#lists-panel')).not.toHaveClass(/hidden/);

  // Delete "Delete Me"
  const deleteRow = page.locator('.list-item').filter({ hasText: 'Delete Me' });
  await deleteRow.locator('.list-item-delete').click();

  await expect(page.locator('.list-item-title').filter({ hasText: 'Delete Me' })).toHaveCount(0);
  await expect(page.locator('.list-item-title').filter({ hasText: 'Keep Me' })).toHaveCount(1);
});
