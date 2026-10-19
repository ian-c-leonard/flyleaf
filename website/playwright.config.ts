import { defineConfig } from '@playwright/test';
export default defineConfig({
  // FLYLEAF_E2E_DIR runs a family's own specs (for example ../../website/e2e)
  // against that family's build; the default specs use the sample family.
  testDir: process.env.FLYLEAF_E2E_DIR || './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: process.env.FAMILY_BASE_URL || 'http://127.0.0.1:4173',
    headless: true,
    channel: 'chrome',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
