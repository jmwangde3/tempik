import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep every cache inside the repo: the default resolves through the OS temp
  // directory, which some locked-down environments do not allow writing to.
  cacheDir: '.vite-cache',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
