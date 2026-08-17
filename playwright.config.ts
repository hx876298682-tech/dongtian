import { defineConfig } from '@playwright/test';

import { loadE2EEnvironment } from './tests/e2e/e2e-env.js';

const environment = loadE2EEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: environment.webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm test:e2e:serve',
    url: environment.webOrigin,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
