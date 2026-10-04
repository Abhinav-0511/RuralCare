import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Starts one in-memory MongoDB; each test file uses its own database on it.
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 30_000,
    // First run downloads the mongod binary.
    hookTimeout: 180_000,
  },
});
