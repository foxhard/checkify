import { test, expect } from '../fixtures.js';

// TC-01: Title gate
test('title gate blocks tree until title is provided', async ({ page }) => {
  await page.goto('/checkify/app/');
  await expect(page.locator('#mode-badge')).toHaveText('EDITING');

  await expect(page.locator('#tree-root')).toHaveAttribute('inert', '');

  await page.locator('#list-title').fill('My List');
  await expect(page.locator('#tree-root')).not.toHaveAttribute('inert');

  await page.locator('#list-title').fill('');
  await expect(page.locator('#tree-root')).toHaveAttribute('inert', '');
});

// TC-02: Keyboard operations
test('tree editing — keyboard add, indent, unindent, delete', async ({ page }) => {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill('Keyboard Test');

  await page.locator('.node-label').first().click();
  await page.keyboard.type('Item One');

  // Enter → new sibling
  await page.keyboard.press('Enter');
  await expect(page.locator('.node-label')).toHaveCount(2);
  await page.locator('.node-label').nth(1).click();

  // Tab → indent to depth 1
  await page.keyboard.press('Tab');
  await expect(page.locator('.tree-node').nth(1)).toHaveAttribute('style', /--node-depth:\s*1/);

  // Shift+Tab → back to depth 0
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.tree-node').nth(1)).toHaveAttribute('style', /--node-depth:\s*0/);

  // Backspace on empty node → deleted
  await page.keyboard.press('Backspace');
  await expect(page.locator('.node-label')).toHaveCount(1);
});

// TC-03: Move up / move down
test('tree editing — move-up and move-down buttons reorder nodes', async ({ page }) => {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill('Reorder Test');

  await page.locator('.node-label').first().click();
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await expect(page.locator('.node-label')).toHaveCount(2);
  await page.locator('.node-label').nth(1).click();
  await page.keyboard.type('Second');

  await expect(page.locator('.node-label').nth(0)).toHaveText('First');
  await expect(page.locator('.node-label').nth(1)).toHaveText('Second');

  // Move "First" down
  await page.locator('.tree-node').nth(0).locator('[data-action="move-down"]').click();
  await expect(page.locator('.node-label').nth(0)).toHaveText('Second');
  await expect(page.locator('.node-label').nth(1)).toHaveText('First');

  // Move "First" back up
  await page.locator('.tree-node').nth(1).locator('[data-action="move-up"]').click();
  await expect(page.locator('.node-label').nth(0)).toHaveText('First');
  await expect(page.locator('.node-label').nth(1)).toHaveText('Second');
});

// TC-04: Text sub-mode round-trip
test('text sub-mode round-trip preserves and updates content', async ({ page }) => {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill('My List');

  await page.locator('.node-label').first().click();
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('.node-label')).toHaveCount(2);
  await page.locator('.node-label').nth(1).click();
  await page.keyboard.type('Beta');

  // Switch to text mode
  await page.locator('#btn-text-mode').click();
  await expect(page.locator('#text-editor')).toBeVisible();
  await expect(page.locator('#tree-root')).not.toBeVisible();

  const textContent = await page.locator('#text-editor').inputValue();
  expect(textContent).toContain('My List');
  expect(textContent).toContain('Alpha');
  expect(textContent).toContain('Beta');

  // Edit the textarea
  const updated = textContent.replace('Beta', 'Gamma');
  await page.locator('#text-editor').fill(updated);

  // Switch back to visual
  await page.locator('#btn-text-mode').click();
  await expect(page.locator('#tree-root')).toBeVisible();

  const allLabels = await page.locator('.node-label').allTextContents();
  expect(allLabels).toContain('Gamma');
  expect(allLabels).not.toContain('Beta');
});

// TC-05: Cancel editing reverts changes
test('cancel editing reverts unsaved changes to the saved state', async ({ page }) => {
  await page.goto('/checkify/app/');

  await page.locator('#list-title').fill('Revert Test');
  await page.locator('.node-label').first().click();
  await page.keyboard.type('Original');
  await page.locator('#btn-save').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');

  // Enter editing and change the label
  await page.locator('#btn-edit').click();
  await expect(page.locator('#mode-badge')).toHaveText('EDITING');

  await page.locator('.node-label').first().fill('Changed');
  await expect(page.locator('.node-label').first()).toHaveText('Changed');

  // Cancel → original restored
  await page.locator('#btn-cancel').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');
  await expect(page.locator('.node-label').first()).toHaveText('Original');
});

// TC-06: New checklist confirm guard
test('new checklist shows confirm and resets state on accept', async ({ page }) => {
  await page.goto('/checkify/app/');

  await page.locator('#list-title').fill('Draft');
  await page.locator('.node-label').first().click();
  await page.keyboard.type('Some item');

  // Dismiss → content preserved
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#btn-new').click();
  await expect(page.locator('#list-title')).toHaveText('Draft');
  await expect(page.locator('.node-label').first()).toHaveText('Some item');

  // Accept → resets to blank
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#btn-new').click();
  await expect(page.locator('#mode-badge')).toHaveText('EDITING');
  await expect(page.locator('#list-title')).toHaveText('');
  await expect(page.locator('.node-label').first()).toHaveText('');
});

// TC-15: Add-child button guard
test('add-child button hidden for empty node, appears in real-time while typing, enables child creation', async ({ page }) => {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill('Child Test');

  // Empty node → no add-child button
  await expect(page.locator('.tree-node').nth(0).locator('[data-action="add-child"]')).toHaveCount(0);

  // Type a label — button appears immediately (before blur)
  await page.locator('.node-label').first().click();
  await page.keyboard.type('Parent');
  await expect(page.locator('.tree-node').nth(0).locator('[data-action="add-child"]')).toHaveCount(1);

  // Clear the label while still focused — button disappears immediately
  await page.locator('.node-label').first().fill('');
  // Trigger input event after programmatic fill
  await page.locator('.node-label').first().dispatchEvent('input');
  await expect(page.locator('.tree-node').nth(0).locator('[data-action="add-child"]')).toHaveCount(0);

  // Type label again — button appears again before blur
  await page.locator('.node-label').first().click();
  await page.keyboard.type('Parent');
  await expect(page.locator('.tree-node').nth(0).locator('[data-action="add-child"]')).toHaveCount(1);

  // Click add-child button → depth-1 child created
  await page.locator('.tree-node').nth(0).locator('[data-action="add-child"]').click();
  await expect(page.locator('.node-label')).toHaveCount(2);
  await expect(page.locator('.tree-node').nth(1)).toHaveAttribute('style', /--node-depth:\s*1/);
});
