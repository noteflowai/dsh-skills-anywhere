import { defineConfig } from 'tsdown'

/**
 * Two host entries built straight from `src/`: the Cordis plugin (`index`) and
 * the standalone CLI (`cli`). Runtime dependencies stay external; everything
 * else inlines so a git install with `prepare` produces a self-contained lib/.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  deps: { dts: { neverBundle: true } },
  tsconfig: 'tsconfig.json',
})
