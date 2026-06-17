// Bundles the extension and the MCP server into self-contained files so the
// .vsix ships without node_modules. Run with `node build.js` (add --watch to watch).
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** Extension: CJS, `vscode` stays external (provided by the host). */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: false,
  minify: true,
};

/**
 * MCP server: ESM (package.json has "type":"module"), runs as `node index.js`.
 * The createRequire banner lets bundled CJS deps (express) call require() at runtime.
 */
const mcpConfig = {
  entryPoints: ['mcp-server/src/index.ts'],
  bundle: true,
  outfile: 'mcp-server/dist/index.js',
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: false,
  minify: true,
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
};

async function run() {
  if (watch) {
    const ctxExt = await esbuild.context(extensionConfig);
    const ctxMcp = await esbuild.context(mcpConfig);
    await Promise.all([ctxExt.watch(), ctxMcp.watch()]);
    console.log('[build] watching...');
  } else {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(mcpConfig)]);
    console.log('[build] done');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
