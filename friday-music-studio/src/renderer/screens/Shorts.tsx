import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, assetUrl, renderUrl } from '../api';
import type { ScreenProps } from '../App';
import { LyricPreview } from '../components/LyricPreview';
import { Badge, ErrorBanner, fmtBytes, fmtDate, ProjectPicker, Section, useAction } from '../components/common';
import { activeCue, formatMs } from '../../shared/cues';
import { clampShort, SHORT_MAX_MS, SHORT_MIN_MS, suggestHookStart, suggestShortParts } from '../../shared/shorts';
import type { ProjectDetail, RenderProgressEvent } from '../../shared/types';

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const picKey = (id: string) => `fms.short.pic.${id}`;

interface Range {
  startMs: number;
  lengthMs: number;
}

/** The song as a waveform. Drag the edges to choose the part for the Short, or drag the middle to slide it. */
function SongRange({
  peaks,
  durationMs,
  range,
  playheadMs,
  marks,
  onRange,
  onSeek,
}: {
  peaks: number[];
  durationMs: number;
  range: Range;
  playheadMs: number;
  marks: number[];
  onRange: (r: Range) => void;
  onSeek: (ms: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: 'start' | 'end' | 'move'; x: number; range: Range } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const t = track.current;
    if (!c || !t) return;
    const dpr = window.devicePixelRatio || 1;
    const w = t.clientWidth;
    const h = t.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const bw = w / peaks.length;
    g.fillStyle = '#8f86ff';
    peaks.forEach((p, i) => {
      const bh = Math.max(2, p * (h - 8));
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 1), bh);
    });
  }, [peaks]);

  const msAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(durationMs, Math.max(0, ((clientX - r.left) / r.width) * durationMs));
  };
  const pct = (ms: number) => `${(ms / durationMs) * 100}%`;
  const begin = (mode: 'start' | 'end' | 'move') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, range };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dms = ((e.clientX - d.x) / track.current!.getBoundingClientRect().width) * durationMs;
    const end = d.range.startMs + d.range.lengthMs;
    if (d.mode === 'move') onRange(clampShort({ startMs: d.range.startMs + dms, lengthMs: d.range.lengthMs, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs));
    if (d.mode === 'start') {
      const s = Math.min(Math.max(0, d.range.startMs + dms), end - SHORT_MIN_MS);
      onRange({ startMs: Math.max(s, end - SHORT_MAX_MS), lengthMs: end - Math.max(s, end - SHORT_MAX_MS) });
    }
    if (d.mode === 'end') {
      const e2 = Math.min(durationMs, Math.max(d.range.startMs + SHORT_MIN_MS, end + dms));
      onRange({ startMs: d.range.startMs, lengthMs: Math.min(SHORT_MAX_MS, e2 - d.range.startMs) });
    }
  };
  const stop = () => {
    drag.current = null;
  };

  return (
    <div className="wave" ref={track} onPointerDown={(e) => onSeek(msAt(e.clientX))} onPointerMove={move} onPointerUp={stop}>
      <canvas ref={canvas} />
      {marks.map((m, i) => (
        <i key={i} className="wave-mark" style={{ left: pct(m) }} />
      ))}
      <div className="wave-shade" style={{ left: 0, width: pct(range.startMs) }} />
      <div className="wave-shade" style={{ left: pct(range.startMs + range.lengthMs), right: 0 }} />
      <div className="wave-sel" style={{ left: pct(range.startMs), width: pct(range.lengthMs) }} onPointerDown={begin('move')}>
        <b className="wave-handle left" onPointerDown={begin('start')} title="Drag to change where the Short starts" />
        <b className="wave-handle right" onPointerDown={begin('end')} title="Drag to change where the Short ends" />
      </div>
      <u className="wave-head" style={{ left: pct(playheadMs) }} />
    </div>
  );
}

export function Shorts({ projectId, setProjectId, open }: ScreenProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [range, setRange] = useState<Range>({ startMs: 0, lengthMs: 30_000 });
  const [nowMs, setNowMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [picId, setPicId] = useState<string | null>(null);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<'fill' | 'whole'>('fill');
  const [quality, setQuality] = useState<'1080p' | '4k'>('1080p');
  const [render, setRender] = useState<RenderProgressEvent | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { busy, error, setError, run } = useAction();

  const load = useCallback(async () => {
    if (!projectId) return setDetail(null);
    setDetail(await api.getProject(projectId));
  }, [projectId]);

  useEffect(() => {
    setPeaks(null);
    setRender(null);
    setPlaying(false);
    void run(load);
  }, [load, run]);

  const project = detail?.project;
  const audio = detail?.assets.find((a) => a.id === project?.chosenAudioAssetId) ?? null;
  const durationMs = audio?.durationSec ? Math.round(audio.durationSec * 1000) : 0;
  const cues = detail?.cues ?? [];
  const pictures = (detail?.assets ?? []).filter((a) => a.kind === 'image' && a.id !== project?.branding.logoAssetId);
  const picture = pictures.find((a) => a.id === picId) ?? pictures.find((a) => a.id === project?.backgroundAssetId) ?? pictures[0] ?? null;
  const imageAspect = picture?.width && picture?.height ? picture.width / picture.height : 16 / 9;

  // Remember the picture chosen for Shorts, per project.
  useEffect(() => {
    if (!projectId) return;
    try {
      setPicId(localStorage.getItem(picKey(projectId)));
    } catch {
      setPicId(null);
    }
  }, [projectId]);
  const choosePicture = (id: string) => {
    setPicId(id);
    setFocus({ x: 0.5, y: 0.5 });
    setZoom(1);
    try {
      if (projectId) localStorage.setItem(picKey(projectId), id);
    } catch {
      /* remembering is a convenience only */
    }
  };

  // Waveform and a first guess for the part: the chorus.
  useEffect(() => {
    if (!projectId || !audio) return;
    let alive = true;
    api.songPeaks(projectId).then((r) => alive && setPeaks(r.peaks)).catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId, audio?.id, setError]);
  useEffect(() => {
    if (!durationMs) return;
    setRange(clampShort({ startMs: suggestHookStart(cues), lengthMs: 30_000, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs));
    // Only when the song or project changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.id, durationMs]);

  useEffect(
    () =>
      api.onRenderProgress((e) => {
        if (e.projectId !== projectId) return;
        setRender(e);
        if (e.status !== 'running') void load();
      }),
    [projectId, load],
  );

  // Follow the audio, and stop at the end of the chosen part.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const ms = a.currentTime * 1000;
        setNowMs(ms);
        if (ms >= range.startMs + range.lengthMs) {
          a.pause();
          a.currentTime = range.startMs / 1000;
          setNowMs(range.startMs);
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, range.startMs, range.lengthMs]);

  const seek = (ms: number) => {
    if (audioRef.current) audioRef.current.currentTime = ms / 1000;
    setNowMs(ms);
  };
  const playPart = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    if (nowMs < range.startMs || nowMs >= range.startMs + range.lengthMs - 200) seek(range.startMs);
    void a.play();
    setPlaying(true);
  };

  const marks = useMemo(() => cues.map((c) => c.startMs), [cues]);
  // Best parts of the song, found from the lyrics and the loudness. Recomputed for the length you have chosen.
  const suggestions = useMemo(
    () => (peaks && durationMs ? suggestShortParts({ cues, peaks, durationMs, lengthMs: range.lengthMs }) : []),
    [cues, peaks, durationMs, range.lengthMs],
  );
  const picked = useRef<string | null>(null);
  useEffect(() => {
    // The first time the waveform arrives for a song, start on the best part instead of an empty guess.
    if (!peaks || !audio || picked.current === audio.id) return;
    picked.current = audio.id;
    const best = suggestShortParts({ cues, peaks, durationMs, lengthMs: 30_000 })[0];
    if (best) setRange({ startMs: best.startMs, lengthMs: best.lengthMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks, audio?.id]);
  const useAndListen = (r: Range) => {
    setRange(r);
    seek(r.startMs);
    void audioRef.current?.play();
    setPlaying(true);
  };
  const current = activeCue(cues, nowMs);
  const rendering = render?.status === 'running';
  const shorts = (detail?.renders ?? []).filter((r) => (r.probe?.height ?? 0) > (r.probe?.width ?? 0));
  const endMs = range.startMs + range.lengthMs;
  const setLength = (sec: number) => setRange(clampShort({ startMs: range.startMs, lengthMs: sec * 1000, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs));

  return (
    <div className="screen">
      <h1>Shorts</h1>
      <p className="muted">Make a vertical clip for YouTube Shorts and TikTok: choose the song, the picture, then the part you want.</p>
      <ProjectPicker projectId={projectId} setProjectId={setProjectId} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {project && detail && !audio && (
        <p className="muted">
          This project has no song yet. <button className="link" onClick={() => open('video', project.id)}>Import audio in Video Studio</button>
        </p>
      )}
      {project && detail && audio && (
        <>
          <Section title="1 · The song">
            <div className="row wrap">
              <b>{audio.originalName}</b>
              <span className="muted">{mmss(durationMs)} long</span>
              <audio ref={audioRef} src={assetUrl(audio.id)} onPause={() => setPlaying(false)} preload="auto" />
            </div>
          </Section>

          <Section title="2 · The picture (thumbnail)">
            <div className="row wrap">
              {pictures.map((p) => (
                <button key={p.id} className={`pic-choice ${picture?.id === p.id ? 'active' : ''}`} onClick={() => choosePicture(p.id)} title={p.originalName}>
                  <img src={assetUrl(p.id)} alt="" />
                </button>
              ))}
              <button
                onClick={() =>
                  run(async () => {
                    const a = await api.importAsset(project.id, 'image');
                    await load();
                    if (a) choosePicture(a.id);
                  })
                }
              >
                Upload a picture…
              </button>
            </div>
          </Section>

          <Section title="3 · The part of the song">
            {!peaks && <p className="muted">Reading the song…</p>}
            {peaks && (
              <SongRange
                peaks={peaks}
                durationMs={durationMs}
                range={range}
                playheadMs={nowMs}
                marks={marks}
                onRange={setRange}
                onSeek={(ms) => seek(ms)}
              />
            )}
            <div className="row wrap">
              <Badge tone="ok">starts {formatMs(range.startMs).slice(0, 8)}</Badge>
              <Badge tone="ok">ends {formatMs(endMs).slice(0, 8)}</Badge>
              <Badge tone="muted">{Math.round(range.lengthMs / 1000)} seconds</Badge>
              <button className="primary" onClick={playPart}>{playing ? 'Stop' : 'Play this part'}</button>
              <button onClick={() => setRange(clampShort({ startMs: suggestHookStart(cues), lengthMs: range.lengthMs, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs))}>Pick the chorus</button>
              <button onClick={() => setRange(clampShort({ startMs: nowMs, lengthMs: range.lengthMs, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs))} title="Start where the white line is">Start here</button>
              {[15, 30, 45, 60].map((s) => (
                <button key={s} className={Math.round(range.lengthMs / 1000) === s ? 'active' : ''} onClick={() => setLength(s)}>{s}s</button>
              ))}
            </div>
            {suggestions.length > 0 && (
              <div className="suggestions">
                <b>Best parts I found for you</b>
                <div className="row wrap">
                  {suggestions.map((s) => {
                    const active = Math.abs(s.startMs - range.startMs) < 500 && Math.abs(s.lengthMs - range.lengthMs) < 500;
                    return (
                      <div key={s.label + s.startMs} className={`suggest ${active ? 'active' : ''}`}>
                        <b>{s.label}</b>
                        <span>{mmss(s.startMs)} to {mmss(s.startMs + s.lengthMs)} ({Math.round(s.lengthMs / 1000)}s)</span>
                        <small className="muted">{s.why}</small>
                        <div className="row">
                          <button className="small" onClick={() => setRange({ startMs: s.startMs, lengthMs: s.lengthMs })}>Use this</button>
                          <button className="small" onClick={() => useAndListen({ startMs: s.startMs, lengthMs: s.lengthMs })}>Use and listen</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="muted small-text">Drag the left or right edge to change the start or end. Drag the middle to slide the whole part. Click the waveform to move the white line and listen from there. Thin lines are where lyrics start.</p>
          </Section>

          <Section title="4 · Frame it">
            <div className="short-box">
              <div className="vpreview big">
                <LyricPreview
                  branding={project.branding}
                  background={null}
                  cue={current}
                  short={{ focusX: focus.x, focusY: focus.y, zoom, fit, imageAspect, assetId: picture?.id ?? null, onPan: (x, y) => setFocus({ x, y }) }}
                />
              </div>
              <div className="controls">
                <p className="muted small-text">Drag the picture in the phone to choose what shows. Zoom in to keep just the face.</p>
                <label className="field">
                  <span>Zoom ({Math.round(zoom * 100)}%)</span>
                  <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>Picture fit</span>
                  <select value={fit} onChange={(e) => setFit(e.target.value as 'fill' | 'whole')}>
                    <option value="fill">Fill the screen (crops the sides)</option>
                    <option value="whole">Whole picture in the middle, blurred copy above and below</option>
                  </select>
                </label>
                <div className="row wrap">
                  <button onClick={() => { setFocus({ x: 0.5, y: 0.5 }); setZoom(1); }}>Centre and reset zoom</button>
                </div>
                <p className="muted small-text">
                  Lyrics use your Branding: font, size, colour, logo and position.{' '}
                  <button className="link" onClick={() => open('video', project.id)}>Change them in Video Studio</button>. Keep text out of the bottom 20%, where the apps cover the video.
                </p>
              </div>
            </div>
          </Section>

          <Section title="5 · Make the Short">
            <div className="row">
              <label className="muted small-text">
                Quality{' '}
                <select value={quality} disabled={rendering} onChange={(e) => setQuality(e.target.value as '1080p' | '4k')}>
                  <option value="1080p">1080p (1080×1920, fast)</option>
                  <option value="4k">4K (2160×3840, slower, bigger file)</option>
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || rendering}
                onClick={() =>
                  run(async () => {
                    const r = await api.startRender(project.id, quality, {
                      startMs: range.startMs,
                      lengthMs: range.lengthMs,
                      focusX: focus.x,
                      focusY: focus.y,
                      zoom,
                      fit,
                      backgroundAssetId: picture?.id ?? null,
                    });
                    setRender({ jobId: r.jobId, projectId: project.id, status: 'running', progress: 0, error: null });
                  })
                }
              >
                Export Short
              </button>
              {rendering && <button onClick={() => run(() => api.cancelRender(render!.jobId))}>Cancel</button>}
            </div>
            {render && (
              <div className="progress-wrap">
                <div className="progress">
                  <div style={{ width: `${Math.round(render.progress * 100)}%` }} />
                </div>
                <span>
                  {render.status === 'running' && `Rendering ${Math.round(render.progress * 100)}%`}
                  {render.status === 'succeeded' && 'Done. The Short is saved below and in your Library folder.'}
                  {render.status === 'cancelled' && 'Cancelled. Partial file removed.'}
                  {render.status === 'failed' && 'Failed.'}
                </span>
                {render.error && <pre className="exact">{render.error}</pre>}
              </div>
            )}
            <ul className="list">
              {shorts.map((r) => (
                <li key={r.id}>
                  {r.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="bad">unverified</Badge>} {r.fileName}
                  <span className="muted"> {fmtBytes(r.sizeBytes)} · {r.probe?.width}×{r.probe?.height} · {r.probe?.durationSec.toFixed(0)}s · {fmtDate(r.createdAt)}</span>
                  <span className="row">
                    <button className="small" onClick={() => run(() => api.saveRenderCopy(r.id))}>Save copy…</button>
                    <button className="small" onClick={() => run(() => api.revealRender(r.id))}>Show file</button>
                  </span>
                </li>
              ))}
            </ul>
            {shorts[0] && <video className="short-video" controls src={renderUrl(shorts[0].id)} />}
            <p className="muted small-text">
              Title, description and TikTok caption: <button className="link" onClick={() => open('releases', project.id)}>Releases, Short captions</button>.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
