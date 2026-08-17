import { defineConfig } from '@playwright/test';

import { loadE2EEnvironment } from './tests/e2e/e2e-env.js';

const environment = loadE2EEnvironment();
const executablePath = process.env['PLAYWRIGHT_EXECUTABLE_PATH'];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: environment.webOrigin,
    launchOptions: executablePath ? { executablePath } : undefined,
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
