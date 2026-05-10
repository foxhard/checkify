import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4000';

// When running against a non-localhost origin (e.g. http://jekyll:4000 inside Docker),
// the browser won't treat it as a secure context, so crypto.randomUUID() and crypto.subtle
// are unavailable. Tell Chromium to treat that origin as secure.
const isNonLocalhost = baseURL && !/localhost|127\.0\.0\.1/.test(baseURL);
const chromeArgs = isNonLocalhost
  ? [`--unsafely-treat-insecure-origin-as-secure=${baseURL}`]
  : [];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
    headless: true,
    launchOptions: { args: chromeArgs },
  },
});
