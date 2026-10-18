// Bundles the main process, the sandboxed preload and the render worker.
// The preload must be a single CommonJS file because sandboxed preloads
// can only require a small set of Electron built-ins.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

const entries = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' },
  { entryPoints: ['src/main/render/worker.ts'], outfile: 'dist/main/render-worker.js' },
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js' },
];

for (const entry of entries) {
  if (watch) {
    const ctx = await context({ ...common, ...entry });
    await ctx.watch();
  } else {
    await build({ ...common, ...entry });
  }
}
