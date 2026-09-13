import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // The CLI is exercised through the packed tarball in CI; the browser card is
      // rendered server-side only, so its event handlers are not counted.
      exclude: ['src/cli.ts', 'src/client/index.tsx', 'src/client/styles.ts'],
      // Floors, not targets: a change that drops below them fails `test:coverage`.
      thresholds: { statements: 88, branches: 78, functions: 82, lines: 90 },
    },
  },
})
