import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: [
    {
      command: 'pnpm --filter @peerlink/signaling dev',
      url: 'http://localhost:3001/signal',
      reuseExistingServer: !process.env.CI,
      // signaling 对 GET /signal 返回 426/400 也算"起来了"
      ignoreHTTPSErrors: true,
    },
    {
      command:
        'VITE_SIGNAL_URL=ws://localhost:3001/signal pnpm --filter @peerlink/web build && pnpm --filter @peerlink/web exec vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
