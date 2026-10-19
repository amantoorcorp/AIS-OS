// Integration tests against real ffmpeg/ffprobe and a real SQLite file.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../src/main/db';
import { buildFfmpegArgs, checkFfmpeg, probeMedia, runRender, synthesizeTone, RenderCancelledError } from '../src/main/render/ffmpeg';
import { StudioService } from '../src/main/studio';
import { skyLyricBranding } from '../src/shared/defaults';

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
  store = new Store(path.join(root, 'data', 'friday.sqlite'));
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
});
