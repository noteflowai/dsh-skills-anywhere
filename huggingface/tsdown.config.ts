import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig([
  {
    entry: { app: at('./app.ts') }, outDir: at('../.dsh-showcase/site'),
    platform: 'browser', format: 'iife', target: 'es2022',
    deps: { alwaysBundle: ['yaml', 'mdast-util-from-markdown'] },
    dts: false, clean: true, minify: true, fixedExtension: false,
    outExtensions: () => ({ js: '.js' }),
    outputOptions: { entryFileNames: '[name].js' },
  },
  {
    entry: { build: at('./build.ts') }, outDir: at('../.dsh-showcase/tools'),
    platform: 'node', format: 'esm', target: 'es2024',
    dts: false, clean: true, fixedExtension: false,
  },
])
