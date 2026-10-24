import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { Badge, ErrorBanner, Section, useAction } from '../components/common';
import { VideoStudio } from './VideoStudio';
import { BACKGROUND_PRESETS } from '../../shared/defaults';
import { MIX_MAX_SONGS, planWithAnalysis, tracklist } from '../../shared/mix';
import type { MixInfo, SongAnalysis } from '../../shared/mix';
import type { Project } from '../../shared/types';

interface SongRow {
  project: Project;
  durationMs: number;
  cues: number;
  mock: boolean;
}

type Picture = { type: 'first' } | { type: 'preset'; id: string } | { type: 'upload'; token: string; name: string };

const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function copyText(id: string): void {
  const el = document.getElementById(id) as HTMLTextAreaElement | null;
  if (!el) return;
  el.select();
  document.execCommand('copy');
}

export function Mixes({ open }: ScreenProps) {
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [crossfade, setCrossfade] = useState(6);
  const [auto, setAuto] = useState(true);
  const [matchTempo, setMatchTempo] = useState(true);
  const [analysis, setAnalysis] = useState<Record<string, SongAnalysis & { projectId: string; title: string }>>({});
  const [picture, setPicture] = useState<Picture>({ type: 'first' });
  const [made, setMade] = useState<{ project: Project; mix: MixInfo } | null>(null);
  const [loading, setLoading] = useState(true);
  const { busy, error, setError, run } = useAction();
  const analysing = useAction();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await api.listProjects();
        const rows: SongRow[] = [];
        for (const p of list) {
          const d = await api.getProject(p.id);
          const a = d.assets.find((x) => x.id === d.project.chosenAudioAssetId);
          if (a?.durationSec) rows.push({ project: d.project, durationMs: Math.round(a.durationSec * 1000), cues: d.cues.length, mock: a.source === 'mock_provider' });
        }
        if (alive) setSongs(rows);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setError]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.project.id, s])), [songs]);
  const picked = chosen.map((id) => byId.get(id)).filter((s): s is SongRow => !!s);
  const available = songs.filter((s) => !chosen.includes(s.project.id));
  const analysed = picked.every((s) => analysis[s.project.id]);
  // Same planner the app uses to build the mix, so what you see here is what you get.
  const plan = useMemo(
    () =>
      planWithAnalysis(
        picked.map((s) => analysis[s.project.id] ?? { durationMs: s.durationMs, bpm: null, bpmConfidence: 0, introMs: 0, outroMs: 0 }),
        { crossfadeMs: crossfade * 1000, auto: auto && analysed, matchTempo: matchTempo && analysed },
      ),
    [picked, analysis, crossfade, auto, matchTempo, analysed],
  );
  const list = useMemo(() => tracklist(picked.map((s, i) => ({ title: s.project.title, artist: s.project.artist, startMs: plan.tracks[i]!.startMs })), plan.totalMs), [picked, plan]);
  const move = (i: number, d: -1 | 1) =>
    setChosen((c) => {
      const j = i + d;
      if (j < 0 || j >= c.length) return c;
      const n = [...c];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const analyse = () =>
    analysing.run(async () => {
      const rows = await api.analyzeMix(chosen);
      setAnalysis((a) => ({ ...a, ...Object.fromEntries(rows.map((r) => [r.projectId, r])) }));
    });
  const pictureLabel = picture.type === 'first' ? "the first song's picture" : picture.type === 'preset' ? BACKGROUND_PRESETS.find((p) => p.id === picture.id)?.label ?? picture.id : picture.name;

  return (
    <div className="screen wide">
      <h1>Mixes</h1>
      <p className="muted">Blend several of your songs into one long video: choose the songs, let the app blend them, pick a picture, then style and export on this same page.</p>
      <ErrorBanner error={error ?? analysing.error} onClose={() => (setError(null), analysing.setError(null))} />

      <Section title="1 · Pick the songs, in order">
        {loading && <p className="muted">Looking at your songs…</p>}
        {!loading && songs.length === 0 && <p className="muted">No song with audio yet. Import a song in Video Studio first.</p>}
        <ol className="mix-list">
          {picked.map((s, i) => {
            const a = analysis[s.project.id];
            return (
              <li key={s.project.id}>
                <b>{s.project.title}</b> <span className="muted">{s.project.artist} · {mmss(s.durationMs)} · {s.cues} lyric lines</span>
                {a?.bpm ? <Badge tone={a.bpmConfidence >= 1.5 ? 'ok' : 'muted'}>{a.bpm} BPM</Badge> : null}
                {a && plan.ratios[i] !== 1 && matchTempo && <Badge tone="muted">tempo {plan.ratios[i]! > 1 ? '+' : ''}{((plan.ratios[i]! - 1) * 100).toFixed(1)}%</Badge>}
                {s.mock && <Badge tone="mock">MOCK audio</Badge>}
                <span className="row">
                  <button className="small" disabled={i === 0} onClick={() => move(i, -1)} title="Earlier">↑</button>
                  <button className="small" disabled={i === picked.length - 1} onClick={() => move(i, 1)} title="Later">↓</button>
                  <button className="small danger" onClick={() => setChosen((c) => c.filter((x) => x !== s.project.id))}>Remove</button>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="row wrap">
          <select
            value=""
            disabled={available.length === 0 || chosen.length >= MIX_MAX_SONGS}
            onChange={(e) => e.target.value && setChosen((c) => [...c, e.target.value])}
            aria-label="Add a song"
          >
            <option value="">{available.length ? 'Add a song…' : 'All songs added'}</option>
            {available.map((s) => (
              <option key={s.project.id} value={s.project.id}>
                {s.project.title} ({mmss(s.durationMs)})
              </option>
            ))}
          </select>
          {available.length > 1 && <button onClick={() => setChosen((c) => [...c, ...available.map((s) => s.project.id)])}>Add all</button>}
          {chosen.length > 0 && <button onClick={() => setChosen([])}>Clear</button>}
        </div>
      </Section>

      <Section title="2 · How the songs blend">
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto blend: each blend is as long as the quiet end of one song and quiet start of the next (4 to 12 seconds)</label>
        </div>
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={matchTempo} onChange={(e) => setMatchTempo(e.target.checked)} /> Match tempo: speed each song up or down a little (at most 6%, pitch stays) to match the song before it</label>
        </div>
        {!auto && (
          <label className="field">
            <span>Blend length: {crossfade === 0 ? 'none (one song after the other)' : `${crossfade} seconds`}</span>
            <input type="range" min={0} max={15} step={1} value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} />
          </label>
        )}
        <div className="row wrap">
          <button disabled={picked.length < 1 || analysing.busy} onClick={analyse}>{analysing.busy ? 'Listening to the songs…' : analysed && picked.length ? 'Analyse again' : 'Analyse songs'}</button>
          <span className="muted small-text">
            {analysed && picked.length
              ? `Done. ${picked.slice(1).map((_, i) => `${(plan.fadesMs[i + 1]! / 1000).toFixed(1)}s`).join(', ') || 'No'} blend${picked.length > 2 ? 's' : ''} planned.`
              : 'Auto blend and tempo matching need this first: it finds each song\'s tempo and how quiet its start and end are. It takes a few seconds per song.'}
          </span>
        </div>
        <label className="field">
          <span>Title of the mix</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Mix of ${picked.length || 'your'} songs`} maxLength={200} />
        </label>
      </Section>

      <Section title="3 · The picture">
        <p className="muted small-text">Now: <b>{pictureLabel}</b>. You can still change it, and everything else, after the mix is built.</p>
        <div className="presets">
          <button className={`preset ${picture.type === 'first' ? 'active' : ''}`} onClick={() => setPicture({ type: 'first' })}>
            <span style={{ padding: 18, display: 'block' }}>First song's picture</span>
          </button>
          {BACKGROUND_PRESETS.map((p) => (
            <button key={p.id} className={`preset ${picture.type === 'preset' && picture.id === p.id ? 'active' : ''}`} title={p.label} onClick={() => setPicture({ type: 'preset', id: p.id })}>
              <img src={`./backgrounds/${p.file}`} alt="" />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
        <div className="row wrap">
          <button
            onClick={() =>
              run(async () => {
                const held = await api.pickMixPicture();
                if (held) setPicture({ type: 'upload', token: held.token, name: held.name });
              })
            }
          >
            Upload a picture…
          </button>
        </div>
      </Section>

      <Section title="4 · Length and tracklist">
        {picked.length < 2 ? (
          <p className="muted">Add at least two songs.</p>
        ) : (
          <>
            <div className="row wrap">
              <Badge tone="ok">{picked.length} songs</Badge>
              <Badge tone="ok">total {mmss(plan.totalMs)}</Badge>
              {plan.totalMs >= 3_600_000 && <Badge tone="muted">over an hour</Badge>}
            </div>
            <textarea id="mix-tracklist" rows={Math.min(14, picked.length + 1)} readOnly value={list} />
            <div className="row">
              <button className="small" onClick={() => copyText('mix-tracklist')}>Copy tracklist</button>
              <span className="muted small-text">YouTube turns this into chapters when you paste it in the description, if the first line is 00:00 and there are at least three songs.</span>
            </div>
          </>
        )}
      </Section>

      <Section title="5 · Build the mix">
        <div className="row wrap">
          <button
            className="primary"
            disabled={busy || picked.length < 2}
            onClick={() =>
              run(async () => {
                const pic = picture.type === 'upload' ? { type: 'upload' as const, token: picture.token } : picture;
                setMade(await api.createMix(title.trim(), chosen, crossfade * 1000, auto, matchTempo, pic));
              })
            }
          >
            {busy ? 'Blending… (about a minute)' : made ? 'Build another mix' : 'Build the mix'}
          </button>
        </div>
        <p className="muted small-text">This makes a new project with the blended audio and every song's lyrics in place. Your original songs are not changed.</p>
      </Section>

      {made && (
        <Section title={`6 · Style and export: ${made.project.title} (${mmss(made.mix.totalMs)})`}>
          <p className="muted small-text">This is Video Studio for the new mix: choose the look, fix lyric timing, then export in 1080p or 4K. The tracklist is also in Releases.</p>
          <VideoStudio projectId={made.project.id} setProjectId={() => undefined} open={open} embedded />
        </Section>
      )}
    </div>
  );
}
