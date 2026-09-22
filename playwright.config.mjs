import { defineConfig } from '@playwright/test';
import { prepareChromium } from './scripts/prepare-chromium.mjs';

const chromiumExecutable = await prepareChromium();

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixels: 0,
      threshold: 0,
    },
  },
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath: chromiumExecutable,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: {
    command: 'npm run serve:test',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
