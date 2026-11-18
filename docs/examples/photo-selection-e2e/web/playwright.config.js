import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: 'photo-selection.spec.js',
  workers: 1,
  retries: 0,
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PHOTO_CHROMIUM_EXECUTABLE },
  },
});
