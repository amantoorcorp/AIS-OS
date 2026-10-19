import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, assetUrl, renderUrl } from '../api';
import type { ScreenProps } from '../App';
import { BrandingEditor } from '../components/BrandingEditor';
import { Badge, ErrorBanner, fmtBytes, fmtDate, ProjectPicker, Section, SourceBadge, useAction } from '../components/common';
import { activeCue, cuesFromLyrics, distributeEvenly, formatMs, layoutCue, parseTime, validateCues } from '../../shared/cues';
import { BACKGROUND_PRESETS, skyLyricBranding } from '../../shared/defaults';
import type { Branding, LyricCue, ProjectDetail, RenderProgressEvent } from '../../shared/types';

const newId = () => crypto.randomUUID();

export function VideoStudio({ projectId, setProjectId, open }: ScreenProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [cues, setCues] = useState<LyricCue[]>([]);
  const [savedCues, setSavedCues] = useState('[]');
  const [nowMs, setNowMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tapIndex, setTapIndex] = useState<number | null>(null);
  const [hinted, setHinted] = useState<Set<string>>(new Set());
  const [autoNote, setAutoNote] = useState<{ unheard: string[]; coverage: number } | null>(null);
  const [render, setRender] = useState<RenderProgressEvent | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { busy, error, setError, run } = useAction();

  const load = useCallback(async () => {
    if (!projectId) return setDetail(null);
    const d = await api.getProject(projectId);
    setDetail(d);
    return d;
  }, [projectId]);

  useEffect(() => {
    setRender(null);
    setTapIndex(null);
    void run(async () => {
      const d = await load();
      if (d) {
        setCues(d.cues);
        setSavedCues(JSON.stringify(d.cues));
        const running = d.jobs.find((j) => j.type === 'render' && j.status === 'running');
        if (running) setRender({ jobId: running.id, projectId: d.project.id, status: 'running', progress: running.progress, error: null });
      }
    });
  }, [load, run]);

  useEffect(
    () =>
      api.onRenderProgress((e) => {
        if (e.projectId !== projectId) return;
        setRender(e);
        if (e.status !== 'running') void load();
      }),
    [projectId, load],
  );

  const project = detail?.project;
  const audio = detail?.assets.find((a) => a.id === project?.chosenAudioAssetId) ?? null;
  const background = detail?.assets.find((a) => a.id === project?.backgroundAssetId) ?? null;
  const durationMs = audio?.durationSec ? Math.round(audio.durationSec * 1000) : null;
  const dirty = JSON.stringify(cues) !== savedCues;
  const issues = useMemo(() => validateCues(cues, durationMs), [cues, durationMs]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const current = activeCue(cues, nowMs);

  // Smooth playhead while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audioRef.current) setNowMs(Math.round(audioRef.current.currentTime * 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (ms: number) => {
    const clamped = Math.max(0, Math.min(ms, durationMs ?? ms));
    if (audioRef.current) audioRef.current.currentTime = clamped / 1000;
    setNowMs(clamped);
  };
  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const updateCue = (id: string, patch: Partial<LyricCue>) => setCues((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  /** Tap-sync: T starts the next line at the playhead (closing the previous one), Y ends the current line. */
  const tapStart = useCallback(() => {
    if (tapIndex == null) return;
    const t = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setCues((cs) =>
      cs.map((c, i) => {
        if (i === tapIndex) return { ...c, startMs: t, endMs: Math.max(c.endMs, t + 1500) };
        if (i === tapIndex - 1 && (c.endMs > t || c.endMs <= c.startMs)) return { ...c, endMs: Math.max(c.startMs + 1, t - 50) };
        return c;
      }),
    );
    setTapIndex((i) => (i == null || i + 1 >= cues.length ? null : i + 1));
  }, [tapIndex, cues.length]);
  const tapEnd = useCallback(() => {
    const t = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setCues((cs) => cs.map((c) => (t > c.startMs && t < c.endMs + 5000 && c === activeCueOrLast(cs, t) ? { ...c, endMs: t } : c)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.code === 'Space') (e.preventDefault(), togglePlay());
      else if (e.key === 't' || e.key === 'T') tapStart();
      else if (e.key === 'y' || e.key === 'Y') tapEnd();
      else if (e.key === 'ArrowLeft') seek(nowMs - 2000);
      else if (e.key === 'ArrowRight') seek(nowMs + 2000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveCues = () =>
    run(async () => {
      if (!project) return;
      const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
      await api.saveCues(project.id, sorted);
      setCues(sorted);
      setSavedCues(JSON.stringify(sorted));
    });

  const saveBranding = (b: Branding) => run(async () => { if (project) { await api.updateProject(project.id, { branding: b }); await load(); } });

  if (!project)
    return (
      <div className="screen">
        <h1>Video Studio</h1>
        <ProjectPicker projectId={projectId} setProjectId={setProjectId} />
        <ErrorBanner error={error} onClose={() => setError(null)} />
      </div>
    );

  const audioAssets = detail!.assets.filter((a) => a.kind === 'audio');
  const bgAssets = detail!.assets.filter((a) => a.kind !== 'audio');
  const rendering = render?.status === 'running';

  return (
    <div className="screen wide">
      <h1>Video Studio</h1>
      <ProjectPicker projectId={projectId} setProjectId={setProjectId} />
      <ErrorBanner error={error} onClose={() => setError(null)} />

      <div className="video-layout">
        <div className="stack">
          <LyricPreview branding={project.branding} background={background ? { kind: background.kind, id: background.id } : null} cue={current} />
          <div className="transport">
            <button onClick={togglePlay} disabled={!audio} className="primary">{playing ? 'Pause' : 'Play'}</button>
            <span className="mono">{formatMs(nowMs)}</span>
            <input
              type="range"
              min={0}
              max={durationMs ?? 0}
              step={10}
              value={nowMs}
              disabled={!audio}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
            />
            <span className="mono">{formatMs(durationMs ?? 0)}</span>
          </div>
          {audio && (
            <audio
              ref={audioRef}
              src={assetUrl(audio.id)}
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onSeeked={(e) => setNowMs(Math.round(e.currentTarget.currentTime * 1000))}
            />
          )}
          <p className="muted small-text">Keys: Space play/pause · ←/→ seek 2s · T tap-sync next line · Y end current line</p>

          <Section title="Media">
            <div className="grid2">
              <label className="field">
                <span>Audio</span>
                <select
                  value={project.chosenAudioAssetId ?? ''}
                  onChange={(e) => run(async () => { await api.updateProject(project.id, { chosenAudioAssetId: e.target.value || null }); await load(); })}
                >
                  <option value="">None</option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.source === 'mock_provider' ? '[MOCK] ' : ''}
                      {a.originalName}
                    </option>
                  ))}
                </select>
                {audio && <SourceBadge asset={audio} />}
              </label>
              <label className="field">
                <span>Background</span>
                <select
                  value={project.backgroundAssetId ?? ''}
                  onChange={(e) => run(async () => { await api.updateProject(project.id, { backgroundAssetId: e.target.value || null }); await load(); })}
                >
                  <option value="">Solid colour</option>
                  {bgAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.kind}: {a.originalName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <button onClick={() => run(async () => { await api.importAsset(project.id, 'audio'); await load(); })}>Import audio…</button>
              <button onClick={() => run(async () => { await api.importAsset(project.id, 'image'); await load(); })}>Import image…</button>
              <button onClick={() => run(async () => { await api.importAsset(project.id, 'video'); await load(); })}>Import video…</button>
            </div>
          </Section>

          <Section title="Look">
            <div className="row wrap">
              <button
                className="primary"
                onClick={() =>
                  run(async () => {
                    if (!project.backgroundAssetId) await api.importPreset(project.id, 'sunset');
                    await api.updateProject(project.id, { branding: skyLyricBranding(project.branding) });
                    await load();
                  })
                }
              >
                Apply Sky Lyric style
              </button>
              <span className="muted small-text">Brush capitals, slow sky drift, logo bottom right.</span>
            </div>
            <div className="presets">
              {BACKGROUND_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className="preset"
                  title={p.label}
                  onClick={() => run(async () => { await api.importPreset(project.id, p.id); await load(); })}
                >
                  <img src={`./backgrounds/${p.file}`} alt="" />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Branding">
            <BrandingEditor value={project.branding} onSave={saveBranding} />
          </Section>

          <Section title="Export MP4 (1920×1080)">
            {audio?.source === 'mock_provider' && <div className="banner mock">This project uses MOCK audio. Exports are for testing only and cannot pass release review.</div>}
            <div className="row">
              <button
                className="primary"
                disabled={busy || rendering || !audio || dirty || errorCount > 0}
                title={dirty ? 'Save cues first' : errorCount ? 'Fix timing errors first' : undefined}
                onClick={() => run(async () => { const r = await api.startRender(project.id); setRender({ jobId: r.jobId, projectId: project.id, status: 'running', progress: 0, error: null }); })}
              >
                Export MP4
              </button>
              {rendering && <button onClick={() => run(() => api.cancelRender(render!.jobId))}>Cancel</button>}
              {dirty && <span className="muted">Save cues before exporting.</span>}
            </div>
            {render && (
              <div className="progress-wrap">
                <div className="progress">
                  <div style={{ width: `${Math.round(render.progress * 100)}%` }} />
                </div>
                <span>
                  {render.status === 'running' && `Rendering ${Math.round(render.progress * 100)}%`}
                  {render.status === 'succeeded' && 'Done. Output verified (1920×1080 H.264 + AAC, duration matches).'}
                  {render.status === 'cancelled' && 'Cancelled. Partial file removed.'}
                  {render.status === 'failed' && 'Failed.'}
                </span>
                {render.error && <pre className="exact">{render.error}</pre>}
              </div>
            )}
            <ul className="list">
              {detail!.renders.map((r) => (
                <li key={r.id}>
                  {r.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="bad">unverified</Badge>} {r.fileName}
                  <span className="muted"> {fmtBytes(r.sizeBytes)} · {r.probe?.durationSec.toFixed(1)}s · {fmtDate(r.createdAt)}</span>
                  <span className="row">
                    <button className="small" onClick={() => run(() => api.saveRenderCopy(r.id))}>Save copy…</button>
                    <button className="small" onClick={() => run(() => api.revealRender(r.id))}>Show file</button>
                    <button className="small" onClick={() => open('releases', project.id)}>Final review</button>
                  </span>
                </li>
              ))}
            </ul>
            {detail!.renders[0] && <video className="render-preview" controls src={renderUrl(detail!.renders[0].id)} />}
          </Section>
        </div>

        <Section
          title={`Lyric cues (${cues.length})`}
          actions={
            <>
              {dirty && <Badge tone="warn">unsaved</Badge>}
              <button className="primary" disabled={!dirty || busy} onClick={saveCues}>Save cues</button>
            </>
          }
        >
          <div className="row wrap">
            <button
              className="primary"
              disabled={busy || !audio || !project.lyrics.trim()}
              title="Listens to the song on this Mac and sets each lyric line to when it is sung"
              onClick={() => {
                if (cues.length && !confirm('Replace the current cues with timing found from the audio? Nothing is saved until you click Save cues.')) return;
                void run(async () => {
                  const r = await api.autoTimeCues(project.id);
                  setCues(r.cues);
                  setHinted(new Set(r.hintedCueIds));
                  setAutoNote({ unheard: r.unheardLines, coverage: r.coverage });
                  setTapIndex(null);
                });
              }}
            >
              {busy ? 'Listening… (about 1 to 3 min)' : 'Auto-time from audio'}
            </button>
            <button
              onClick={() => {
                if (cues.length && !confirm('Replace all cues with one per lyric line? Timings will be cleared.')) return;
                setCues(cuesFromLyrics(project.lyrics, newId));
                setTapIndex(null);
              }}
              disabled={!project.lyrics.trim()}
            >
              Cues from lyrics
            </button>
            <button
              disabled={!durationMs || cues.length === 0}
              onClick={() => durationMs && setCues(distributeEvenly([...cues], 0, durationMs))}
              title="Rough starting point only. The singing will not match; adjust afterwards."
            >
              Spread evenly (rough)
            </button>
            <button disabled={!audio || cues.length === 0} className={tapIndex != null ? 'active' : ''} onClick={() => setTapIndex(tapIndex == null ? 0 : null)}>
              {tapIndex != null ? `Tap-sync on (line ${tapIndex + 1})` : 'Tap-sync'}
            </button>
            <button
              onClick={() => setCues((cs) => [...cs, { id: newId(), startMs: nowMs, endMs: Math.min(nowMs + 2000, durationMs ?? nowMs + 2000), text: '' }].sort((a, b) => a.startMs - b.startMs))}
            >
              Add cue at playhead
            </button>
          </div>
          <p className="muted small-text">
            Lyrics on paper rarely match the sung timing exactly. Automatic spreading is only a starting point; every start/end stays editable.
          </p>
          {autoNote && (
            <div className="banner warn">
              <div>
                Matched {Math.round(autoNote.coverage * 100)}% of your lyric lines to the audio. {hinted.size} marked "check by ear" were only
                recognised with your lyrics as a hint: press ▶ on them to confirm.
                {autoNote.unheard.length > 0 && ` ${autoNote.unheard.length} line(s) were not heard and were left out (the singer may skip them):`}
                {autoNote.unheard.length > 0 && <ul>{autoNote.unheard.map((l, k) => <li key={k}>{l}</li>)}</ul>}
              </div>
            </div>
          )}
          {issues.length > 0 && (
            <div className={errorCount ? 'banner error' : 'banner warn'}>
              {errorCount} error(s), {issues.length - errorCount} warning(s). Export is blocked until errors are fixed.
            </div>
          )}
          <div className="cue-table">
            {cues.map((c, i) => {
              const cueIssues = issues.filter((x) => x.cueId === c.id);
              const isNow = current?.id === c.id;
              return (
                <div key={c.id} className={`cue-row ${isNow ? 'now' : ''} ${tapIndex === i ? 'tap' : ''}`}>
                  <div className="cue-times">
                    <TimeInput value={c.startMs} onChange={(v) => updateCue(c.id, { startMs: v })} />
                    <button className="tiny" title="Set start to playhead" onClick={() => updateCue(c.id, { startMs: nowMs })}>⇤</button>
                    <TimeInput value={c.endMs} onChange={(v) => updateCue(c.id, { endMs: v })} />
                    <button className="tiny" title="Set end to playhead" onClick={() => updateCue(c.id, { endMs: nowMs })}>⇥</button>
                  </div>
                  <textarea
                    rows={2}
                    value={c.text}
                    maxLength={400}
                    onChange={(e) => updateCue(c.id, { text: e.target.value })}
                    aria-label={`Cue ${i + 1} text`}
                  />
                  <div className="cue-actions">
                    <button className="tiny" title="Play from here" onClick={() => { seek(c.startMs); void audioRef.current?.play(); }}>▶</button>
                    <button
                      className="tiny"
                      title="Merge with next line (max two lines)"
                      disabled={i === cues.length - 1}
                      onClick={() =>
                        setCues((cs) => {
                          const next = cs[i + 1];
                          if (!next) return cs;
                          const merged = { ...c, text: `${c.text.trim()}\n${next.text.trim()}`, endMs: Math.max(c.endMs, next.endMs) };
                          return [...cs.slice(0, i), merged, ...cs.slice(i + 2)];
                        })
                      }
                    >
                      ⤓
                    </button>
                    <button className="tiny danger" title="Delete cue" onClick={() => setCues((cs) => cs.filter((x) => x.id !== c.id))}>✕</button>
                  </div>
                  {hinted.has(c.id) && <div className="cue-issue warning">Check by ear: heard only with the lyrics as a hint.</div>}
                  {cueIssues.map((x, k) => (
                    <div key={k} className={`cue-issue ${x.level}`}>{x.message}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

function activeCueOrLast(cues: LyricCue[], t: number): LyricCue | null {
  const a = activeCue(cues, t);
  if (a) return a;
  let best: LyricCue | null = null;
  for (const c of cues) if (c.startMs < t && (!best || c.startMs > best.startMs)) best = c;
  return best;
}

function TimeInput({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const [text, setText] = useState(formatMs(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(formatMs(value)), [value]);
  const commit = () => {
    const ms = parseTime(text);
    if (ms == null) return setBad(true);
    setBad(false);
    onChange(ms);
  };
  return (
    <input
      className={`time ${bad ? 'bad' : ''}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      aria-label="Time (mm:ss.mmm)"
    />
  );
}

/** Same layout rules as the ASS export: 1920-wide coordinate space scaled with container units. */
function LyricPreview({ branding, background, cue }: { branding: Branding; background: { kind: string; id: string } | null; cue: LyricCue | null }) {
  const layout = cue ? layoutCue(cue.text, { upper: branding.textCase === 'upper', scale: branding.textScale }) : null;
  const drift = background?.kind === 'image' && branding.backgroundMotion === 'drift';
  return (
    <div className="preview" style={{ background: branding.backgroundColor }}>
      {background?.kind === 'image' && <img className={drift ? 'drift' : ''} src={assetUrl(background.id)} alt="" />}
      {background?.kind === 'video' && <video src={assetUrl(background.id)} muted loop autoPlay playsInline />}
      {background && <div className="dim" style={{ opacity: branding.backgroundDim }} />}
      {branding.watermarkText && <div className={`watermark ${branding.watermarkPosition}`} style={{ fontFamily: `"${branding.fontFamily}", sans-serif` }}>{branding.watermarkText}</div>}
      {layout && (
        <div className={`lyric ${branding.lyricPosition}`} style={{ fontSize: `calc(${layout.fontPx} / 1920 * 100cqw)`, fontFamily: `"${branding.fontFamily}", sans-serif` }}>
          {layout.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      <Badge tone="muted">Preview</Badge>
    </div>
  );
}
