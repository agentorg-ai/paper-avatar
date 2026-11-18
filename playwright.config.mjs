import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.browser.mjs',
  workers: 1,
  timeout: 120_000,
  use: {
    browserName: 'chromium',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    viewport: { width: 800, height: 720 }
  }
});
