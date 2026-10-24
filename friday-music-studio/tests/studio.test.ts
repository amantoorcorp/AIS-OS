// Integration tests against real ffmpeg/ffprobe and a real SQLite file.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../src/main/db';
import { needsUpscale, upscalerInstalled } from '../src/main/upscale';
import { cuesToSrt } from '../src/shared/cues';
import { checkColour } from '../src/main/render/quality';
import { buildFfmpegArgs, checkFfmpeg, encoderTuning, probeMedia, runRender, synthesizeTone, RenderCancelledError } from '../src/main/render/ffmpeg';
import { StudioService } from '../src/main/studio';
import { BACKGROUND_PRESETS, skyLyricBranding } from '../src/shared/defaults';

let root: string;
let fixtures: string;
let studio: StudioService;
let store: Store;

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'fms-test-'));
  fixtures = path.join(root, 'fixtures');
  execFileSync('mkdir', ['-p', fixtures]);
  await synthesizeTone('ffmpeg', path.join(fixtures, 'song.mp3'), 6, 440);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', path.join(fixtures, 'bg.png')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=25', '-t', '2', '-pix_fmt', 'yuv420p', path.join(fixtures, 'bg.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1200x800', '-frames:v', '1', path.join(fixtures, 'photo32.png')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=400x200,format=rgba', '-frames:v', '1', path.join(fixtures, 'logo.png')]);
  store = new Store(path.join(root, 'data', 'friday.sqlite'));
  // Never let tests write into the real ~/Movies library folder.
  store.setSettings({ libraryDir: path.join(root, 'library') });
  studio = new StudioService(store, path.join(root, 'data'), path.resolve(__dirname, '../src/renderer/public'));
});

afterAll(() => {
  store.close();
  if (!process.env.FMS_KEEP_TEST_OUTPUT) rmSync(root, { recursive: true, force: true });
  else console.log('test output kept at', root);
});

async function renderProject(projectId: string) {
  const { job, spec } = studio.prepareRender(projectId);
  const progress: number[] = [];
  const result = await runRender(spec, (p) => progress.push(p), new AbortController().signal);
  const output = await studio.finishRender(job.id, result);
  return { job, spec, progress, output };
}

describe('Phase 1 pipeline', () => {
  it('imports audio + image, saves cues, exports a verified 1080p MP4 with audio', async () => {
    const p = studio.createProject('Test Song', 'Friday');
    const audio = await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    expect(audio.source).toBe('local_import');
    expect(audio.durationSec).toBeGreaterThan(5.5);
    const img = await studio.importAsset(p.id, 'image', path.join(fixtures, 'bg.png'));
    const detail = studio.getDetail(p.id);
    expect(detail.project.chosenAudioAssetId).toBe(audio.id);
    expect(detail.project.backgroundAssetId).toBe(img.id);

    studio.saveCues(p.id, [
      { id: '11111111-1111-4111-8111-111111111111', startMs: 500, endMs: 2500, text: 'Hello Friday night\nwe are alive' },
      { id: '22222222-2222-4222-8222-222222222222', startMs: 2600, endMs: 5000, text: 'second phrase' },
    ]);
    // Reopen from disk: projects persist.
    const reopened = new Store(path.join(root, 'data', 'friday.sqlite'));
    expect(reopened.listCues(p.id)).toHaveLength(2);
    reopened.close();

    const { output, progress } = await renderProject(p.id);
    expect(progress.at(-1)).toBe(1);
    expect(output.verified).toBe(true);
    expect(output.probe).toMatchObject({ width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac' });
    expect(Math.abs(output.probe!.durationSec - audio.durationSec!)).toBeLessThan(0.75);
    const stored = store.getRender(output.id)!.storedPath;
    const probe = await probeMedia('ffprobe', stored);
    expect(probe.width).toBe(1920);
    expect(store.getJob(output.jobId)!.status).toBe('succeeded');
    expect(existsSync(path.join(studio.projectDir(p.id), 'work', output.jobId))).toBe(false);
  });

  it('exports with a looping video background and with no background', async () => {
    const p = studio.createProject('Video BG', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    await studio.importAsset(p.id, 'video', path.join(fixtures, 'bg.mp4'));
    const a = await renderProject(p.id);
    expect(a.output.probe).toMatchObject({ width: 1920, height: 1080 });

    const q = studio.createProject('Plain', '');
    await studio.importAsset(q.id, 'audio', path.join(fixtures, 'song.mp3'));
    const b = await renderProject(q.id);
    expect(b.output.verified).toBe(true);
  });

  it('imports a sky preset and exports still, whole-picture and bundled font', async () => {
    const p = studio.createProject('Sky', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    const sky = await studio.importPreset(p.id, 'sunset');
    expect(studio.getDetail(p.id).project.backgroundAssetId).toBe(sky.id);
    expect((await studio.importPreset(p.id, 'sunset')).id).toBe(sky.id); // no duplicates
    studio.updateProject(p.id, { branding: skyLyricBranding(studio.getDetail(p.id).project.branding) });
    studio.saveCues(p.id, [{ id: '44444444-4444-4444-8444-444444444444', startMs: 200, endMs: 5000, text: 'we chase the light\nbefore it fades' }]);
    const { output, spec } = await renderProject(p.id);
    expect(spec.backgroundMotion).toBe('none');
    expect(spec.backgroundFit).toBe('whole');
    expect(spec.fontsDir).toMatch(/fonts$/);
    expect(output.probe).toMatchObject({ width: 1920, height: 1080 });
  });

  it('blocks export when cues have errors', async () => {
    const p = studio.createProject('Broken', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    studio.saveCues(p.id, [{ id: '33333333-3333-4333-8333-333333333333', startMs: 4000, endMs: 9000, text: 'past the end' }]);
    expect(() => studio.prepareRender(p.id)).toThrow(/timing error/);
  });

  it('cancels a render and leaves no partial file', async () => {
    const p = studio.createProject('Cancel me', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    const { job, spec } = studio.prepareRender(p.id);
    const ac = new AbortController();
    const run = runRender(spec, () => ac.abort(), ac.signal);
    setTimeout(() => ac.abort(), 2000);
    await expect(run).rejects.toBeInstanceOf(RenderCancelledError);
    await studio.failRender(job.id, 'cancelled', null);
    expect(store.getJob(job.id)!.status).toBe('cancelled');
    const renders = path.join(studio.projectDir(p.id), 'renders');
    expect(existsSync(renders) ? readdirSync(renders) : []).toEqual([]);
  });

  it('rejects unsupported or fake media on import', async () => {
    const p = studio.createProject('Bad import', '');
    await expect(studio.importAsset(p.id, 'audio', path.join(fixtures, 'bg.png'))).rejects.toThrow(/Unsupported/);
    await expect(studio.importAsset(p.id, 'audio', path.join(fixtures, 'missing.mp3'))).rejects.toThrow();
  });
});

describe('job recovery', () => {
  it('marks local jobs interrupted and external jobs needs_reconcile', () => {
    const p = studio.createProject('Recovery', '');
    const r = store.createJob('render', p.id, {}, 'running');
    const g = store.createJob('generation', p.id, {}, 'running');
    const u = store.createJob('upload', p.id, {}, 'queued');
    const done = store.createJob('render', p.id, {}, 'succeeded');
    store.recoverJobsAfterRestart();
    expect(store.getJob(r.id)!.status).toBe('interrupted');
    expect(store.getJob(g.id)!.status).toBe('needs_reconcile');
    expect(store.getJob(u.id)!.status).toBe('needs_reconcile');
    expect(store.getJob(done.id)!.status).toBe('succeeded');
  });
});

describe('generation approval (mock provider)', () => {
  it('Suno shows not configured and refuses', async () => {
    const providers = await studio.listProviders();
    expect(providers.find((x) => x.id === 'suno')!.state).toBe('not_configured');
    const p = studio.createProject('Suno', '');
    studio.updateProject(p.id, { lyrics: 'la la', stylePrompt: 'pop' });
    await expect(studio.prepareGeneration(p.id, 'suno')).rejects.toThrow(/Not configured/);
  });

  it('requires a matching single-use approval and labels output as mock', async () => {
    const p = studio.createProject('Mock gen', '');
    studio.updateProject(p.id, { lyrics: 'hello\nworld', stylePrompt: 'lofi chill' });
    const preview = await studio.prepareGeneration(p.id, 'mock');
    expect(preview).toMatchObject({ isMock: true, lyrics: 'hello\nworld', stylePrompt: 'lofi chill', count: 1 });

    // Edited after review -> refused.
    studio.updateProject(p.id, { lyrics: 'hello\nworld!' });
    await expect(studio.approveAndSubmitGeneration(p.id, preview.token)).rejects.toThrow(/changed since review/);
    // Token is single-use even after a refusal.
    await expect(studio.approveAndSubmitGeneration(p.id, preview.token)).rejects.toThrow(/Approval not found/);

    const preview2 = await studio.prepareGeneration(p.id, 'mock');
    const job = await studio.approveAndSubmitGeneration(p.id, preview2.token);
    expect(job.externalId).toMatch(/^mock-/);
    await new Promise((r) => setTimeout(r, 1600));
    const done = await studio.refreshGeneration(job.id);
    expect(done.status).toBe('succeeded');
    const assets = store.listAssets(p.id);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ source: 'mock_provider', kind: 'audio' });
    expect(assets[0]!.originalName).toMatch(/^MOCK /);
    expect(store.listApprovals(p.id).map((a) => a.kind)).toContain('generation');
  });

  it('enforces the 24h generation limit', async () => {
    studio.updateSettings({ generationLimitPer24h: store.countJobsSince('generation', new Date(Date.now() - 864e5).toISOString()) });
    const p = studio.createProject('Limit', '');
    studio.updateProject(p.id, { lyrics: 'x', stylePrompt: 'y' });
    const preview = await studio.prepareGeneration(p.id, 'mock');
    await expect(studio.approveAndSubmitGeneration(p.id, preview.token)).rejects.toThrow(/limit reached/);
    studio.updateSettings({ generationLimitPer24h: 5 });
  });

  it('final review refuses mock audio and requires rights notes', async () => {
    const p = studio.createProject('Review', '');
    studio.updateProject(p.id, { lyrics: 'a', stylePrompt: 'b' });
    const pv = await studio.prepareGeneration(p.id, 'mock');
    const job = await studio.approveAndSubmitGeneration(p.id, pv.token);
    await new Promise((r) => setTimeout(r, 1600));
    await studio.refreshGeneration(job.id);
    const mockAudio = store.listAssets(p.id)[0]!;
    studio.updateProject(p.id, { chosenAudioAssetId: mockAudio.id });
    const { output } = await renderProject(p.id);
    await expect(studio.approveFinalReview(p.id, output.id)).rejects.toThrow(/MOCK/);

    const real = await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    studio.updateProject(p.id, { chosenAudioAssetId: real.id });
    const second = await renderProject(p.id);
    await expect(studio.approveFinalReview(p.id, second.output.id)).rejects.toThrow(/rights-review/);
    studio.updateProject(p.id, { rightsNotes: 'Test tone generated locally; no third-party rights.' });
    const approval = await studio.approveFinalReview(p.id, second.output.id);
    expect((approval.snapshot as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows a 3:2 photo whole (blurred sides) instead of cropping it', async () => {
    const p = studio.createProject('Whole picture', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    await studio.importAsset(p.id, 'image', path.join(fixtures, 'photo32.png'));
    studio.updateProject(p.id, { branding: { ...studio.getDetail(p.id).project.branding, backgroundFit: 'whole', backgroundDim: 0 } });
    studio.saveCues(p.id, [{ id: '55555555-5555-4555-8555-555555555555', startMs: 200, endMs: 4000, text: 'whole picture' }]);
    const { output, spec } = await renderProject(p.id);
    expect(spec.backgroundFit).toBe('whole');
    expect(output.probe).toMatchObject({ width: 1920, height: 1080 });
    const file = path.join(os.tmpdir(), `fms-whole-${Date.now()}.png`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '3', '-i', spec.outputPath, '-frames:v', '1', file]);
    // The picture is shown whole, so its test pattern is not cropped away: frame is 1620px wide in the middle.
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
    expect(probe).toBe('1920,1080');
    rmSync(file, { force: true });
  });

  it('exports a verified 4K (3840x2160) MP4 when asked', async () => {
    const p = studio.createProject('Four K', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    await studio.importAsset(p.id, 'image', path.join(fixtures, 'photo32.png'));
    studio.updateProject(p.id, { branding: { ...studio.getDetail(p.id).project.branding, backgroundFit: 'whole' } });
    studio.saveCues(p.id, [{ id: '66666666-6666-4666-8666-666666666666', startMs: 200, endMs: 4000, text: 'four k lyrics' }]);
    const { job, spec } = studio.prepareRender(p.id, '4k');
    expect(spec).toMatchObject({ width: 3840, height: 2160 });
    const result = await runRender(spec, () => {}, new AbortController().signal);
    const output = await studio.finishRender(job.id, result);
    expect(output.probe).toMatchObject({ width: 3840, height: 2160, videoCodec: 'h264' });
    expect(output.probe?.check).toMatchObject({ tagsOk: true });
    expect(output.probe?.check?.psnrDb ?? 0).toBeGreaterThan(30); // synthetic test pattern; real pictures score 40+
    expect(output.probe?.check?.verdict).not.toBe('not_measured');
    const tags = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_primaries,color_transfer,color_range', '-of', 'csv=p=0', spec.outputPath]).toString().trim();
    expect(tags).toBe('tv,bt709,iec61966-2-1,bt709'); // range, matrix, transfer (sRGB), primaries 
    expect(studio.getDetail(p.id).jobs.find((j) => j.id === job.id)?.status).toBe('succeeded');
  });

  it('skips the blur layer for a 16:9 picture but keeps it for a 3:2 one', () => {
    const base = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', workDir: '/tmp/w', outputPath: '/tmp/o.mp4', audioPath: '/tmp/a.wav', durationSec: 1, background: { kind: 'image' as const, path: '/tmp/i.png' }, backgroundDim: 0, backgroundMotion: 'none' as const, backgroundFit: 'whole' as const, assContent: '', fontsDir: null };
    const graph = (size: { width: number; height: number }) => buildFfmpegArgs({ ...base, backgroundSize: size }, '/tmp/o.partial').join(' ');
    expect(graph({ width: 1672, height: 941 })).not.toContain('boxblur');
    expect(graph({ width: 4256, height: 2832 })).toContain('boxblur');
  });

  it('finds an FFmpeg with libass by itself, and a path chosen in Settings still wins', async () => {
    await studio.detectTools();
    expect((await checkFfmpeg(studio.ffmpegPath())).ok).toBe(true);
    store.setSettings({ ffmpegPath: '/custom/ffmpeg' });
    expect(studio.ffmpegPath()).toBe('/custom/ffmpeg');
    store.setSettings({ ffmpegPath: null });
  });

  it('encodes 4K slower and cleaner than 1080p', () => {
    expect(encoderTuning(2160, 'image')).toEqual(['-preset', 'slow', '-crf', '16', '-tune', 'stillimage']);
    expect(encoderTuning(1080, 'image')).toEqual(['-preset', 'medium', '-crf', '18', '-tune', 'stillimage']);
    expect(encoderTuning(2160, 'video')).not.toContain('-tune');
  });

  it('flags a file tagged the old way (BT.709 curve) that made skin look pale', async () => {
    const bad = path.join(fixtures, 'bad-tags.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(fixtures, 'bg.mp4'), '-c:v', 'libx264', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-t', '1', bad]);
    const spec = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', workDir: path.join(root, 'qwork'), outputPath: bad, audioPath: path.join(fixtures, 'song.mp3'), durationSec: 1, background: { kind: 'color' as const, color: '#202020' }, backgroundDim: 0, backgroundMotion: 'none' as const, assContent: '', fontsDir: null };
    const check = await checkColour(spec, bad);
    expect(check.tagsOk).toBe(false);
  });

  it('mirrors videos, lyrics, subtitles and sources into one Library folder, without extra disk space', async () => {
    const p = studio.createProject('Library Song', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    await studio.importAsset(p.id, 'image', path.join(fixtures, 'bg.png'));
    studio.updateProject(p.id, { lyrics: 'first line\nsecond line' });
    studio.saveCues(p.id, [{ id: '77777777-7777-4777-8777-777777777777', startMs: 200, endMs: 2000, text: 'first line' }]);
    const lib = path.join(root, 'library');
    const { output } = await renderProject(p.id); // finishRender mirrors by itself
    const dir = path.join(lib, 'Library Song');
    const names = readdirSync(dir);
    const mp4 = names.find((n) => n.endsWith('.mp4'))!;
    expect(mp4).toMatch(/^Library Song - 1080p - \d{4}-\d{2}-\d{2} \d{4}\.mp4$/);
    expect(readFileSync(path.join(dir, 'lyrics.txt'), 'utf8')).toBe('first line\nsecond line\n');
    expect(readFileSync(path.join(dir, 'lyrics.srt'), 'utf8')).toContain('00:00:00,200 --> 00:00:02,000\nfirst line');
    expect(readdirSync(path.join(dir, 'source')).sort()).toEqual(['bg.png', 'song.mp3']);
    // Hard link: same file on disk as the app's own copy, so no extra space is used.
    const stored = studio.store.getRender(output.id)!.storedPath;
    expect(statSync(path.join(dir, mp4)).ino).toBe(statSync(stored).ino);
    // Running again changes nothing.
    expect((await studio.syncLibrary(p.id)).videos).toBe(0);
  });

  it('writes standard SRT subtitles', () => {
    expect(cuesToSrt([{ id: 'a', startMs: 3_723_450, endMs: 3_725_000, text: 'two\nlines' }, { id: 'b', startMs: 0, endMs: 0, text: 'skipped' }])).toBe('1\n01:02:03,450 --> 01:02:05,000\ntwo\nlines\n');
  });

  it('decides when AI upscaling applies', () => {
    expect(needsUpscale({ enabled: true, quality: '4k', kind: 'image', widthPx: 1672 })).toBe(true);
    expect(needsUpscale({ enabled: false, quality: '4k', kind: 'image', widthPx: 1672 })).toBe(false);
    expect(needsUpscale({ enabled: true, quality: '1080p', kind: 'image', widthPx: 1672 })).toBe(false);
    expect(needsUpscale({ enabled: true, quality: '4k', kind: 'image', widthPx: 4256 })).toBe(false);
    expect(needsUpscale({ enabled: true, quality: '4k', kind: 'video', widthPx: 1280 })).toBe(false);
  });

  it('uses the AI-upscaled picture for a 4K render when installed (skipped where the upscaler is absent)', async (ctx) => {
    const installed = path.join(os.homedir(), 'Library', 'Application Support', 'friday-music-studio', 'tools');
    if (existsSync(installed)) process.env.FMS_TOOLS_DIR = installed;
    if (!(await upscalerInstalled(studio.dataDir))) return ctx.skip();
    const p = studio.createProject('Upscaled', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    await studio.importAsset(p.id, 'image', path.join(fixtures, 'bg.png')); // 1280x720
    studio.updateProject(p.id, { branding: { ...studio.getDetail(p.id).project.branding, backgroundUpscale: true } });
    studio.saveCues(p.id, [{ id: '88888888-8888-4888-8888-888888888888', startMs: 200, endMs: 2000, text: 'sharp' }]);
    const { spec } = studio.prepareRender(p.id, '4k');
    const finalSpec = await studio.applyUpscale(p.id, spec, '4k');
    expect(finalSpec.background).toMatchObject({ kind: 'image' });
    expect((finalSpec.background as { path: string }).path).toMatch(/-x4\.png$/);
    expect(finalSpec.backgroundSize).toEqual({ width: 5120, height: 2880 });
    // Off => untouched.
    studio.updateProject(p.id, { branding: { ...studio.getDetail(p.id).project.branding, backgroundUpscale: false } });
    expect((await studio.applyUpscale(p.id, spec, '4k')).background).toEqual(spec.background);
  }, 120_000);

  it('puts the logo in the corner of the export without becoming the background', async () => {
    const p = studio.createProject('Logo Song', '');
    await studio.importAsset(p.id, 'audio', path.join(fixtures, 'song.mp3'));
    await studio.importAsset(p.id, 'image', path.join(fixtures, 'bg.png'));
    const bg = studio.getDetail(p.id).project.backgroundAssetId;
    const logo = await studio.importLogo(p.id, path.join(fixtures, 'logo.png'));
    const d = studio.getDetail(p.id).project;
    expect(d.backgroundAssetId).toBe(bg); // the logo never replaces the background
    expect(d.branding.logoAssetId).toBe(logo.id);
    studio.updateProject(p.id, { branding: { ...d.branding, watermarkPosition: 'bottom_right', logoSize: 9, backgroundDim: 0 } });
    studio.updateProject(p.id, { backgroundAssetId: null }); // solid dark colour, so anything red must be the logo
    studio.saveCues(p.id, [{ id: '99999999-9999-4999-8999-999999999999', startMs: 200, endMs: 1500, text: 'logo' }]);
    const { spec } = await renderProject(p.id);
    expect(spec.logo).toMatchObject({ widthPercent: 9, position: 'bottom_right' });
    // Red logo, 172x86 px, 50px from the bottom-right corner: its centre is at about (1784, 987).
    const px = (x: number, y: number) =>
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '2', '-i', spec.outputPath, '-vf', `crop=4:4:${x}:${y},scale=1:1:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const inside = px(1782, 985);
    expect(inside[0]).toBeGreaterThan(180);
    expect(inside[1]).toBeLessThan(80);
    expect(inside[2]).toBeLessThan(80);
    const outside = px(1500, 985); // left of the logo: plain dark background
    expect(outside[0]).toBeLessThan(60);
  });

  it('ships every background preset as a 16:9 picture and imports them', async () => {
    const bundled = path.resolve(__dirname, '../src/renderer/public/backgrounds');
    expect(BACKGROUND_PRESETS.length).toBeGreaterThanOrEqual(12);
    for (const pr of BACKGROUND_PRESETS) {
      const probe = await probeMedia('ffprobe', path.join(bundled, pr.file));
      expect(probe.width! / probe.height!, pr.id).toBeCloseTo(16 / 9, 2);
      expect(probe.width!, pr.id).toBeGreaterThanOrEqual(2560);
    }
    const p = studio.createProject('Presets', '');
    for (const id of ['ocean', 'aurora'] as const) {
      const a = await studio.importPreset(p.id, id);
      expect(studio.getDetail(p.id).project.backgroundAssetId).toBe(a.id);
      expect(a.originalName).toBe(`Preset: ${BACKGROUND_PRESETS.find((x) => x.id === id)!.label}`);
    }
  });

  it('exports a vertical 9:16 Short of one section with only that section\'s audio and lyrics', async () => {
    const p = studio.createProject('Short Song', '');
    const long = path.join(fixtures, 'long.mp3');
    await synthesizeTone('ffmpeg', long, 20, 330);
    await studio.importAsset(p.id, 'audio', long);
    await studio.importAsset(p.id, 'image', path.join(fixtures, 'bg.png'));
    studio.saveCues(p.id, [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startMs: 1000, endMs: 3000, text: 'before the clip' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', startMs: 8500, endMs: 10_500, text: 'inside the clip, a longer line to wrap' },
    ]);
    const { job, spec } = studio.prepareRender(p.id, '1080p', { startMs: 8000, lengthMs: 6000, focusX: 0.25, fit: 'fill' });
    expect(spec).toMatchObject({ width: 1080, height: 1920, audioStartSec: 8, focusX: 0.25 });
    expect(spec.durationSec).toBeCloseTo(6, 1);
    expect(spec.assContent).toContain('PlayResX: 1080');
    expect(spec.assContent).toContain('PlayResY: 1920');
    expect(spec.assContent).not.toContain('before the clip');
    expect(spec.assContent).toMatch(/inside the clip/i);
    expect(spec.assContent).toContain('0:00:00.50'); // cue at 8.5 s starts 0.5 s into the clip
    const result = await runRender(spec, () => {}, new AbortController().signal);
    const output = await studio.finishRender(job.id, result);
    expect(output.probe).toMatchObject({ width: 1080, height: 1920, videoCodec: 'h264' });
    expect(output.probe!.durationSec).toBeCloseTo(spec.durationSec, 0);
    expect(output.fileName).toBe('Short Song Short.mp4');
    expect(output.probe?.check?.tagsOk).toBe(true);
    // The Library names it as a Short.
    expect(readdirSync(path.join(root, 'library', 'Short Song')).some((n) => /Short 1080p/.test(n))).toBe(true);
  });
});
