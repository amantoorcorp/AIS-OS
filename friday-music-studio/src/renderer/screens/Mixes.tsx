import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { Badge, ErrorBanner, Section, useAction } from '../components/common';
import { clampCrossfade, MIX_MAX_SONGS, planMix, tracklist } from '../../shared/mix';
import type { MixInfo } from '../../shared/mix';
import type { Project } from '../../shared/types';

interface SongRow {
  project: Project;
  durationMs: number;
  cues: number;
  mock: boolean;
}

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
  const [made, setMade] = useState<{ project: Project; mix: MixInfo } | null>(null);
  const [loading, setLoading] = useState(true);
  const { busy, error, setError, run } = useAction();

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
  const plan = useMemo(() => planMix(picked.map((s) => s.durationMs), crossfade * 1000), [picked, crossfade]);
  const list = useMemo(() => tracklist(picked.map((s, i) => ({ title: s.project.title, artist: s.project.artist, startMs: plan.tracks[i]!.startMs })), plan.totalMs), [picked, plan]);
  const effectiveCrossfade = clampCrossfade(crossfade * 1000, picked.map((s) => s.durationMs));
  const move = (i: number, d: -1 | 1) =>
    setChosen((c) => {
      const j = i + d;
      if (j < 0 || j >= c.length) return c;
      const n = [...c];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  return (
    <div className="screen">
      <h1>Mixes</h1>
      <p className="muted">Blend several of your songs into one long video. Each song fades into the next, and the lyrics and a tracklist follow along.</p>
      <ErrorBanner error={error} onClose={() => setError(null)} />
      <Section title="1 · Pick the songs, in order">
        {loading && <p className="muted">Looking at your songs…</p>}
        {!loading && songs.length === 0 && <p className="muted">No song with audio yet. Import a song in Video Studio first.</p>}
        <ol className="mix-list">
          {picked.map((s, i) => (
            <li key={s.project.id}>
              <b>{s.project.title}</b> <span className="muted">{s.project.artist} · {mmss(s.durationMs)} · {s.cues} lyric lines</span>
              {s.mock && <Badge tone="mock">MOCK audio</Badge>}
              <span className="row">
                <button className="small" disabled={i === 0} onClick={() => move(i, -1)} title="Earlier">↑</button>
                <button className="small" disabled={i === picked.length - 1} onClick={() => move(i, 1)} title="Later">↓</button>
                <button className="small danger" onClick={() => setChosen((c) => c.filter((x) => x !== s.project.id))}>Remove</button>
              </span>
            </li>
          ))}
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
        <label className="field">
          <span>Blend length: {crossfade === 0 ? 'none (one song after the other)' : `${effectiveCrossfade / 1000} seconds`}</span>
          <input type="range" min={0} max={15} step={1} value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} />
        </label>
        <p className="muted small-text">
          The next song starts while the last one fades out. 4 to 8 seconds sounds smooth for deep house. Songs are brought to the same loudness first. A blend can never be longer than a third of your shortest song.
        </p>
        <label className="field">
          <span>Title of the mix</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Mix of ${picked.length || 'your'} songs`} maxLength={200} />
        </label>
      </Section>

      <Section title="3 · Length and tracklist">
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

      <Section title="4 · Make the mix">
        <div className="row wrap">
          <button
            className="primary"
            disabled={busy || picked.length < 2}
            onClick={() =>
              run(async () => {
                setMade(await api.createMix(title.trim(), chosen, crossfade * 1000));
              })
            }
          >
            {busy ? 'Blending… (about a minute)' : 'Build the mix'}
          </button>
        </div>
        <p className="muted small-text">This makes a new project with the blended audio, every song's lyrics in place, and the first song's picture and look. Your original songs are not changed. Then you style and export it in Video Studio like any other project, in 1080p or 4K.</p>
        {made && (
          <div className="banner ok">
            <div>
              Done: <b>{made.project.title}</b> is ready ({mmss(made.mix.totalMs)}).
              <div className="row">
                <button className="primary" onClick={() => open('video', made.project.id)}>Open in Video Studio</button>
                <button onClick={() => open('shorts', made.project.id)}>Make a Short from it</button>
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
