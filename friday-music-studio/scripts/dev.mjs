// Dev loop: Vite dev server for the renderer, esbuild watch for main/preload,
// then Electron pointed at the dev server.
import { spawn } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const children = [];
const run = (args, env = {}) => {
  const child = spawn(npx, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  return child;
};

run(['vite']);
run(['node', 'scripts/build-main.mjs', '--watch']);
setTimeout(() => {
  const electron = run(['electron', '.'], { FMS_DEV_SERVER_URL: 'http://localhost:5173' });
  electron.on('exit', () => {
    for (const c of children) c.kill();
    process.exit(0);
  });
}, 2500);
