import { useCallback, useEffect, useState } from 'react';
import { api, renderUrl } from '../api';
import type { ScreenProps } from '../App';
import { Badge, ErrorBanner, fmtBytes, fmtDate, ProjectPicker, Section, useAction } from '../components/common';
import { formatInZone } from '../../shared/defaults';
import { buildReleaseText, buildShortCaptions } from '../../shared/release-text';
import { hookLine } from '../../shared/shorts';
import type { LyricCue, Project, ProjectDetail } from '../../shared/types';

const TEXT_KEY = 'fms.releaseText.v1';
const TEXT_DEFAULTS = {
  fullVideoUrl: '',
  subscribeUrl: '',
  streamUrl: '',
  genreTags: '#deephouse #englishdeephouse',
  aiCredit: 'Made with AI tools (Suno). The picture is AI-generated.',
};

function loadTextPrefs(): typeof TEXT_DEFAULTS {
  try {
    return { ...TEXT_DEFAULTS, ...(JSON.parse(localStorage.getItem(TEXT_KEY) ?? '{}') as Partial<typeof TEXT_DEFAULTS>) };
  } catch {
    return TEXT_DEFAULTS;
  }
}

/** Selecting and copying through a textarea works without any browser permission. */
function copyFrom(id: string): void {
  const el = document.getElementById(id) as HTMLTextAreaElement | null;
  if (!el) return;
  el.select();
  document.execCommand('copy');
}

function ReleaseText({ project, cues }: { project: Project; cues: LyricCue[] }) {
  const [prefs, setPrefs] = useState(loadTextPrefs);
  const [artist, setArtist] = useState(project.artist || 'HEATDRIFT');
  useEffect(() => setArtist(project.artist || 'HEATDRIFT'), [project.id, project.artist]);
  const update = (patch: Partial<typeof TEXT_DEFAULTS>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(TEXT_KEY, JSON.stringify(next));
    } catch {
      /* remembering is a convenience only */
    }
  };
  const text = buildReleaseText({ artist, songTitle: project.title, lyrics: project.lyrics, subscribeUrl: prefs.subscribeUrl, streamUrl: prefs.streamUrl, genreTags: prefs.genreTags, aiCredit: prefs.aiCredit });
  const hook = hookLine(cues);
  const shorts = buildShortCaptions({ artist, songTitle: project.title, hook, fullVideoUrl: prefs.fullVideoUrl, genreTags: prefs.genreTags });
  return (
    <Section title="Release text (title, description, hashtags)">
      <p className="muted small-text">Pattern from lyric-video channels: "Artist - Song (Lyrics)", three hashtags first, short emoji lines, then the lyrics. Copy it into YouTube yourself.</p>
      <div className="kv">
        <label className="field"><span>Artist or channel</span><input value={artist} onChange={(e) => setArtist(e.target.value)} /></label>
        <label className="field"><span>Channel link (with ?sub_confirmation=1)</span><input value={prefs.subscribeUrl} onChange={(e) => update({ subscribeUrl: e.target.value })} /></label>
        <label className="field"><span>Stream link (optional)</span><input value={prefs.streamUrl} onChange={(e) => update({ streamUrl: e.target.value })} /></label>
        <label className="field"><span>Genre hashtags</span><input value={prefs.genreTags} onChange={(e) => update({ genreTags: e.target.value })} /></label>
        <label className="field"><span>AI credit line</span><input value={prefs.aiCredit} onChange={(e) => update({ aiCredit: e.target.value })} /></label>
      </div>
      {text.warnings.map((w) => (
        <div key={w} className="banner warn">{w}</div>
      ))}
      <label className="field">
        <span>Title ({text.title.length}/100)</span>
        <textarea id="release-title" rows={1} readOnly value={text.title} />
        <button className="small" onClick={() => copyFrom('release-title')}>Copy title</button>
      </label>
      <label className="field">
        <span>Description ({text.description.length}/5000) · top hashtags: {text.topHashtags.join(' ')}</span>
        <textarea id="release-description" rows={12} readOnly value={text.description} />
        <button className="small" onClick={() => copyFrom('release-description')}>Copy description</button>
      </label>
      <h3>Short captions (YouTube Shorts and TikTok)</h3>
      <label className="field"><span>Link to the full video on YouTube</span><input value={prefs.fullVideoUrl} onChange={(e) => update({ fullVideoUrl: e.target.value })} /></label>
      <p className="muted small-text">Hook line found in your lyrics: {hook ? `"${hook}"` : 'none repeats yet'}</p>
      {shorts.warnings.map((w) => (
        <div key={w} className="banner warn">{w}</div>
      ))}
      <label className="field">
        <span>YouTube Shorts title</span>
        <textarea id="short-title" rows={1} readOnly value={shorts.youtubeTitle} />
        <button className="small" onClick={() => copyFrom('short-title')}>Copy</button>
      </label>
      <label className="field">
        <span>YouTube Shorts description</span>
        <textarea id="short-description" rows={5} readOnly value={shorts.youtubeDescription} />
        <button className="small" onClick={() => copyFrom('short-description')}>Copy</button>
      </label>
      <label className="field">
        <span>TikTok caption</span>
        <textarea id="short-tiktok" rows={5} readOnly value={shorts.tiktokCaption} />
        <button className="small" onClick={() => copyFrom('short-tiktok')}>Copy</button>
      </label>
    </Section>
  );
}

export function Releases({ projectId, setProjectId, open }: ScreenProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [checks, setChecks] = useState({ watched: false, lyrics: false, rights: false });
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();

  const load = useCallback(async () => {
    if (!projectId) return setDetail(null);
    const d = await api.getProject(projectId);
    setDetail(d);
    setOutputId((cur) => cur ?? d.renders.find((r) => r.verified)?.id ?? null);
  }, [projectId]);

  useEffect(() => {
    setOutputId(null);
    setDone(null);
    setChecks({ watched: false, lyrics: false, rights: false });
    void run(load);
  }, [load, run]);

  const p = detail?.project;
  const output = detail?.renders.find((r) => r.id === outputId) ?? null;
  const allChecked = checks.watched && checks.lyrics && checks.rights;
  const approved = detail?.approvals.find((a) => a.kind === 'final_review' && (a.snapshot as { outputId?: string }).outputId === outputId);

  return (
    <div className="screen">
      <h1>Releases</h1>
      <ProjectPicker projectId={projectId} setProjectId={setProjectId} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {p && detail && (
        <>
          <ReleaseText project={p} cues={detail.cues} />
          <Section title="1 · Final review">
            {detail.renders.length === 0 && (
              <p className="muted">
                No exports yet. <button className="link" onClick={() => open('video', p.id)}>Export in Video Studio</button>
              </p>
            )}
            {detail.renders.length > 0 && (
              <>
                <label className="field">
                  <span>Export to review</span>
                  <select value={outputId ?? ''} onChange={(e) => (setOutputId(e.target.value), setChecks({ watched: false, lyrics: false, rights: false }))}>
                    {detail.renders.map((r) => (
                      <option key={r.id} value={r.id} disabled={!r.verified}>
                        {fmtDate(r.createdAt)} · {fmtBytes(r.sizeBytes)} {r.verified ? '' : '(unverified)'}
                      </option>
                    ))}
                  </select>
                </label>
                {output && <video className="render-preview" controls src={renderUrl(output.id)} />}
                <div className="kv">
                  <span>Title</span>
                  <span>{p.title}</span>
                  <span>Artist</span>
                  <span>{p.artist || <em className="muted">none</em>}</span>
                  <span>Rights notes</span>
                  <span>{p.rightsNotes || <em className="muted">Missing. Add them in Song Studio.</em>}</span>
                </div>
                {approved ? (
                  <div className="banner ok">Final review approved {fmtDate(approved.createdAt)} for this exact file (SHA-256 recorded).</div>
                ) : (
                  <div className="stack">
                    <label className="check">
                      <input type="checkbox" checked={checks.watched} onChange={(e) => setChecks({ ...checks, watched: e.target.checked })} />I watched the
                      full video with sound
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={checks.lyrics} onChange={(e) => setChecks({ ...checks, lyrics: e.target.checked })} />
                      On-screen lyrics match what is actually sung, in time
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={checks.rights} onChange={(e) => setChecks({ ...checks, rights: e.target.checked })} />I have the rights
                      to publish the music, lyrics and background
                    </label>
                    <div className="row">
                      <button
                        className="primary"
                        disabled={!allChecked || !output || busy}
                        onClick={() =>
                          run(async () => {
                            await api.approveFinalReview(p.id, output!.id);
                            setDone('Final review recorded.');
                            await load();
                          })
                        }
                      >
                        Approve final review
                      </button>
                      {done && <Badge tone="ok">{done}</Badge>}
                    </div>
                  </div>
                )}
              </>
            )}
          </Section>

          <Section title="2 · Upload to YouTube (PRIVATE)">
            <p>
              <Badge tone="bad">Not available</Badge> <span className="muted">YouTube is not connected. OAuth and the first approved PRIVATE test upload are Phase 3.</span>
            </p>
            <button disabled>Upload as PRIVATE…</button>
          </Section>

          <Section title="3 · Schedule release">
            <p className="muted">
              Phase 4. Release times are stored in UTC and shown in {p.releaseTimezone}. YouTube performs the release; this app never publishes on a local timer.
            </p>
            {p.releaseAtUtc && <p>Planned: {formatInZone(p.releaseAtUtc, p.releaseTimezone)}</p>}
            <button disabled>Schedule…</button>
          </Section>

          <Section title="Approval history">
            {detail.approvals.length === 0 && <p className="muted">No approvals yet.</p>}
            <ul className="list">
              {detail.approvals.map((a) => (
                <li key={a.id}>
                  <Badge tone="muted">{a.kind.replace('_', ' ')}</Badge> <span className="muted">{fmtDate(a.createdAt)}</span>
                  {(a.snapshot as { isMock?: boolean }).isMock && <Badge tone="mock">MOCK</Badge>}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
