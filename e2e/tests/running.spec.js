import { test, expect } from '../fixtures.js';

async function setupList(page, title, items) {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill(title);
  await page.locator('.node-label').first().click();
  await page.keyboard.type(items[0]);
  for (let i = 1; i < items.length; i++) {
    await page.keyboard.press('Enter');
    await expect(page.locator('.node-label')).toHaveCount(i + 1);
    await page.locator('.node-label').nth(i).click();
    await page.keyboard.type(items[i]);
  }
  await page.locator('#btn-save').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');
}

async function setupParentWithChildren(page) {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill('Cascade Test');
  await page.locator('.node-label').first().click();
  await page.keyboard.type('Parent');
  await page.keyboard.press('Enter');
  await expect(page.locator('.node-label')).toHaveCount(2);
  await page.locator('.node-label').nth(1).click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Child 1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.node-label')).toHaveCount(3);
  await page.locator('.node-label').nth(2).click();
  await page.keyboard.type('Child 2');
  await page.locator('#btn-save').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');
}

// TC-07: Checkbox toggle + progress bar
test('checking items updates the progress bar', async ({ page }) => {
  await setupList(page, 'Progress Test', ['Item 1', 'Item 2']);

  await expect(page.locator('#global-label')).toHaveText('0 / 2');

  await page.locator('.node-checkbox').nth(0).click();
  await expect(page.locator('#global-label')).toHaveText('1 / 2');

  await page.locator('.node-checkbox').nth(1).click();
  await expect(page.locator('#global-label')).toHaveText('2 / 2');
});

// TC-08: Cascade parent → children
test('checking parent cascades checked state to all children', async ({ page }) => {
  await setupParentWithChildren(page);

  const checkboxes = page.locator('.node-checkbox');
  await expect(checkboxes).toHaveCount(3);

  // Check parent → all children checked
  await checkboxes.nth(0).click();
  await expect(checkboxes.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(checkboxes.nth(2)).toHaveAttribute('aria-checked', 'true');

  // Uncheck parent → all children unchecked
  await checkboxes.nth(0).click();
  await expect(checkboxes.nth(1)).toHaveAttribute('aria-checked', 'false');
  await expect(checkboxes.nth(2)).toHaveAttribute('aria-checked', 'false');
});

// TC-09: Cascade children → parent
test('checking all children auto-checks the parent', async ({ page }) => {
  await setupParentWithChildren(page);

  const checkboxes = page.locator('.node-checkbox');

  // Check child 1 only → parent still unchecked
  await checkboxes.nth(1).click();
  await expect(checkboxes.nth(0)).toHaveAttribute('aria-checked', 'false');

  // Check child 2 → parent auto-checks
  await checkboxes.nth(2).click();
  await expect(checkboxes.nth(0)).toHaveAttribute('aria-checked', 'true');
});
