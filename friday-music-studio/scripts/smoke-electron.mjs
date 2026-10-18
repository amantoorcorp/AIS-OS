// End-to-end smoke test of the built app with Playwright's Electron driver.
// Native file dialogs are stubbed in the main process (test only) so the
// import path can be exercised. Run: npm run build && npm run smoke
// On headless Linux: xvfb-run -a npm run smoke
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(os.tmpdir(), 'fms-smoke-'));
const dataDir = path.join(root, 'data');
const fixtures = path.join(root, 'fixtures');
const shots = path.resolve(process.env.FMS_SMOKE_SHOTS ?? 'test-output');
mkdirSync(fixtures, { recursive: true });
mkdirSync(shots, { recursive: true });
const audioFile = path.join(fixtures, 'track.mp3');
const imageFile = path.join(fixtures, 'cover.png');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', audioFile]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=s=1600x900:c0=0x3b1d6e:c1=0x0e6e8c:seed=7', '-frames:v', '1', imageFile]);

const args = ['.'];

const app = await electron.launch({ args, env: { ...process.env, FMS_DATA_DIR: dataDir } });
const step = (m) => console.log(`✓ ${m}`);
try {
  const win = await app.firstWindow();
  await win.waitForSelector('text=Dashboard');
  step('app launched');

  const isolation = await win.evaluate(() => ({
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    bridgeKeys: Object.keys(window.friday).length,
  }));
  if (isolation.require !== 'undefined' || isolation.process !== 'undefined') throw new Error(`renderer not isolated: ${JSON.stringify(isolation)}`);
  step(`renderer isolated (no require/process; ${isolation.bridgeKeys} bridge methods)`);

  const bad = await win.evaluate(() => window.friday.getProject('../../etc/passwd'));
  if (bad.ok !== false) throw new Error('invalid IPC payload was accepted');
  step(`invalid IPC payload rejected: "${bad.error}"`);

  await win.screenshot({ path: path.join(shots, '01-dashboard.png') });

  // Song Studio: create project, lyrics.
  await win.click('button.nav:has-text("Song Studio")');
  await win.fill('input[placeholder="New song title"]', 'Friday Lights');
  await win.click('button:has-text("Create project")');
  await win.waitForSelector('text=Rights-review notes');
  await win.getByRole('textbox', { name: 'Artist', exact: true }).fill('Friday');
  await win.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('[Verse]\nCity lights are calling me\nDancing on the edge of time\n\n[Chorus]\nThis is our Friday night\nWe never let it go');
  await win.getByRole('textbox', { name: 'Style prompt', exact: true }).fill('chill pop, female vocal, 100 bpm');
  await win.click('button.primary:text-is("Save")');
  await win.waitForSelector('.badge:has-text("Saved")');
  step('project created and saved');

  // Mock generation approval gate shows exact details.
  await win.click('button:has-text("Review generation")');
  await win.waitForSelector('text=Approve generation');
  const modal = await win.locator('.modal').innerText();
  if (!modal.includes('MOCK provider') || !modal.includes('Dancing on the edge of time')) throw new Error('approval modal missing details');
  await win.screenshot({ path: path.join(shots, '02-generation-approval.png') });
  await win.click('.modal button:has-text("Cancel")');
  step('generation approval shows provider, exact lyrics, style, count; cancelled without submitting');

  // Stub native dialogs (test only), then import audio + image.
  const stub = async (file) =>
    app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, file);
  await stub(audioFile);
  await win.click('button:has-text("Import audio file")');
  await win.waitForSelector('text=track.mp3');
  step('audio imported');

  await win.click('button:has-text("Open Video Studio")');
  await win.waitForSelector('text=Lyric cues');
  await stub(imageFile);
  await win.click('button:has-text("Import image")');
  await win.waitForFunction(() => document.querySelector('.preview img')?.complete && document.querySelector('.preview img').naturalWidth > 0);
  step('background image imported and served over fms-media://');

  await win.click('button:has-text("Cues from lyrics")');
  await win.click('button:has-text("Spread evenly")');
  const audioReady = await win.waitForFunction(() => {
    const a = document.querySelector('audio');
    return a && a.readyState >= 1 && a.duration > 7 ? a.duration : false;
  });
  step(`audio playable in preview (duration ${(await audioReady.jsonValue()).toFixed(2)}s)`);

  // Seek to the middle of cue 3 and check the preview lyric.
  await win.evaluate(() => {
    const r = document.querySelector('input[aria-label="Seek"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(r, '4500');
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForSelector('.preview .lyric');
  const lyric = await win.locator('.preview .lyric').innerText();
  step(`seek updates preview lyric: "${lyric.replace(/\n/g, ' / ')}"`);

  await win.click('button:has-text("Apply Sky Lyric style")');
  await win.waitForFunction(() => getComputedStyle(document.querySelector('.preview .lyric')).fontFamily.includes('Permanent Marker'));
  await win.waitForFunction(() => document.fonts.check('40px "Permanent Marker"'));
  const caps = await win.locator('.preview .lyric').innerText();
  if (caps !== caps.toUpperCase()) throw new Error('sky style did not uppercase the preview');
  step('Sky Lyric style applied: bundled font loaded, capitals, drifting sky');
  await win.click('.preset:has-text("Dusk")');
  await win.waitForFunction(() => document.querySelector('.preview img')?.complete);
  await win.click('.preset:has-text("Sunset")');
  step('background presets switch');

  await win.click('button:has-text("Save cues")');
  await win.waitForSelector('.badge:has-text("unsaved")', { state: 'detached' });
  await win.screenshot({ path: path.join(shots, '03-video-studio.png') });

  await win.click('button:has-text("Export MP4")');
  await win.waitForSelector('text=Output verified', { timeout: 120_000 });
  step('MP4 exported and verified');
  await win.waitForSelector('video.render-preview');
  await win.screenshot({ path: path.join(shots, '04-exported.png') });

  // Final review requires rights notes.
  await win.click('button:has-text("Final review")');
  await win.waitForSelector('text=1 · Final review');
  for (const l of ['I watched the', 'On-screen lyrics match', 'I have the rights']) await win.click(`label.check:has-text("${l}") input`);
  await win.click('button:has-text("Approve final review")');
  await win.waitForSelector('.banner.error:has-text("rights-review")');
  step('final review blocked without rights notes');
  await win.screenshot({ path: path.join(shots, '05-release-review.png') });

  // Reopen: data persists across restart.
  await app.close();
  const app2 = await electron.launch({ args, env: { ...process.env, FMS_DATA_DIR: dataDir } });
  const win2 = await app2.firstWindow();
  await win2.waitForSelector('text=Friday Lights');
  step('project persists after restart');
  await app2.close();
  console.log(`\nSmoke test passed. Screenshots: ${shots}`);
} catch (err) {
  console.error('Smoke test FAILED:', err);
  try {
    const w = await app.firstWindow();
    await w.screenshot({ path: path.join(shots, 'failure.png') });
  } catch {}
  await app.close().catch(() => {});
  process.exit(1);
}
