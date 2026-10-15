import { defineConfig } from 'vitest/config';

// Pure client logic and asset tools; rendering and audio output are checked in Chromium separately.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/tools/**/*.test.ts'],
    environment: 'node',
  },
});
