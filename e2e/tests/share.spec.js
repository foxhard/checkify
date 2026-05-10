import { test, expect } from '../fixtures.js';

async function createAndSave(page, title, items = ['Item 1']) {
  await page.goto('/checkify/app/');
  await page.locator('#list-title').fill(title);
  await page.locator('.node-label').first().click();
  await page.keyboard.type(items[0]);
  for (let i = 1; i < items.length; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(items[i]);
  }
  await page.locator('#btn-save').click();
  await expect(page.locator('#mode-badge')).toHaveText('RUNNING');
}

// TC-10: Share panel open/close and public URL
test('share panel opens, shows a URL, and closes on Escape', async ({ page }) => {
  await createAndSave(page, 'Share Test');

  await page.locator('#btn-share').click();
  await expect(page.locator('#share-panel')).not.toHaveClass(/hidden/);

  // URL should be populated (async encode)
  await expect(page.locator('#share-url')).not.toHaveValue('');
  const url = await page.locator('#share-url').inputValue();
  expect(url).toContain('#');

  // Escape closes the panel
  await page.keyboard.press('Escape');
  await expect(page.locator('#share-panel')).toHaveClass(/hidden/);
});

// TC-11: Copy link
test('copy link button shows confirmation status', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createAndSave(page, 'Copy Test');

  await page.locator('#btn-share').click();
  await expect(page.locator('#share-url')).not.toHaveValue('');

  await page.locator('#share-copy').click();
  await expect(page.locator('#share-copy-status')).not.toHaveClass(/hidden/);
});

// TC-12: Protected checklist — create and decode
test('protected checklist requires correct passphrase to open', async ({ page }) => {
  await createAndSave(page, 'Secret List', ['Top secret']);

  await page.locator('#btn-share').click();
  await expect(page.locator('#share-panel')).toHaveClass(/open/);

  // Wait for public URL to be generated before switching modes
  await expect(page.locator('#share-url')).not.toHaveValue('');
  const publicUrl = await page.locator('#share-url').inputValue();

  // Switch to protected mode
  await page.locator('#mode-toggle').click();
  await expect(page.locator('#passphrase-section')).not.toHaveClass(/hidden/);
  await page.locator('#share-password').fill('hunter2');

  // Wait for the protected URL to replace the public one
  await expect(page.locator('#share-url')).not.toHaveValue(publicUrl);
  await expect(page.locator('#share-url')).not.toHaveValue('');
  const protectedUrl = await page.locator('#share-url').inputValue();
  expect(protectedUrl).toContain('#');

  // The page URL already has the protected hash (regenHash updates location.hash),
  // so page.goto(protectedUrl) would be a hash-only navigation with no full reload.
  // Navigate to about:blank first to force init() to run fresh on the protected URL.
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(protectedUrl);

  // Password modal must appear
  await expect(page.locator('#password-modal')).not.toHaveClass(/hidden/);

  // Wrong password → error shown
  await page.locator('#modal-password').fill('wrongpass');
  await page.locator('#modal-submit').click();
  await expect(page.locator('#modal-error')).not.toHaveClass(/hidden/);

  // Correct password → checklist loads
  await page.locator('#modal-password').fill('hunter2');
  await page.locator('#modal-submit').click();
  await expect(page.locator('#password-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#list-title')).toHaveText('Secret List');
  await expect(page.locator('.node-label').first()).toHaveText('Top secret');
});
