import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string }

/**
 * Module specifiers the dsh web shell provides to every plugin bundle
 * (`PLATFORM_MODULES`). Anything else a client bundle imports is inlined.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

export default defineConfig([
  /**
   * Host entries built straight from `src/`: the Cordis plugin (`index`), its
   * tools (`tools`), the MCP server (`mcp`) and the standalone CLI (`cli`).
   * Runtime dependencies stay external; everything else inlines so a git
   * install with `prepare` produces a self-contained lib/.
   */
  {
    entry: {
      index: 'src/index.ts',
      tools: 'src/tools.ts',
      mcp: 'src/mcp.ts',
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
  },
  /**
   * Browser half for the dsh web UI, in the client module system's lazy-CJS
   * factory format: one classic script that registers `{ id, factory }` on
   * `window.__ModuleLoader__`; the factory receives a synchronous `require`
   * that resolves the platform modules above.
   */
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    // A `"type": "module"` package would otherwise get `.cjs`; the client
    // module system serves `exports["./client"]` as a classic script, so `.js`.
    outExtensions: () => ({ js: '.js' }),
    // The plugin face is declared by hand in `types/client.d.ts`.
    dts: false,
    clean: false,
    deps: { neverBundle: PLATFORM_MODULES },
    outputOptions: {
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
      footer: 'return module.exports; } });',
    },
    tsconfig: 'tsconfig.json',
  },
])
