import { test, expect } from '../fixtures.js';

test('create a checklist, save it, and reload to verify auto-load', async ({ page }) => {
  await page.goto('/checkify/app/');

  await expect(page.locator('#mode-badge')).toHaveText('EDITING');

  await page.locator('#list-title').fill('Smoke Test List');
  await expect(page.locator('#list-title')).toHaveText('Smoke Test List');
  await expect(page.locator('#tree-root')).not.toHaveAttribute('inert');

  await page.locator('.node-label').first().click();
  await page.keyboard.type('Buy groceries');

  await page.locator('#btn-save').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');

  await page.waitForFunction(() =>
    Object.keys(localStorage).some(k => k.startsWith('checkify_'))
  );

  await page.reload();
  await expect(page.locator('#list-title')).toHaveText('Smoke Test List');
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');
  await expect(page.locator('.node-label').first()).toHaveText('Buy groceries');
});
