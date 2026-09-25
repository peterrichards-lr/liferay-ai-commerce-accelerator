import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /e2e/,
  timeout: 240000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: '../test-results/',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8080',
    ignoreHTTPSErrors: true,
    actionTimeout: 60000,
    navigationTimeout: 60000,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        '--allow-running-insecure-content',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests',
      ],
    },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'desktop-chrome',
      testMatch: /.*\.spec\.js/,
      // `setup` writes this and nothing consumed it: the project declared the
      // dependency but never the state, so authentication was whatever each
      // spec remembered to ask for. Four did; `smoke/full-journey.spec.js` did
      // not, and reached the control panel as a guest. Default it here so the
      // next spec cannot quietly run unauthenticated. A spec that needs a
      // different identity can still override with `test.use`. See #1150.
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
