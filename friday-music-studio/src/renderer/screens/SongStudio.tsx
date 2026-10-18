import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { Badge, ErrorBanner, fmtBytes, fmtDate, JobBadge, ProjectPicker, Section, SourceBadge, useAction } from '../components/common';
import type { GenerationPreview, ProjectDetail, ProviderInfo } from '../../shared/types';

export function SongStudio({ projectId, setProjectId, open }: ScreenProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [form, setForm] = useState({ title: '', artist: '', lyrics: '', stylePrompt: '', rightsNotes: '' });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState('mock');
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();

  const load = useCallback(async () => {
    if (!projectId) return setDetail(null);
    const d = await api.getProject(projectId);
    setDetail(d);
    const p = d.project;
    setForm({ title: p.title, artist: p.artist, lyrics: p.lyrics, stylePrompt: p.stylePrompt, rightsNotes: p.rightsNotes });
  }, [projectId]);

  useEffect(() => {
    void run(load);
    api.listProviders().then(setProviders).catch(() => undefined);
    return api.onJobsChanged(() => void load().catch(() => undefined));
  }, [load, run]);

  const p = detail?.project;
  const dirty = !!p && (form.title !== p.title || form.artist !== p.artist || form.lyrics !== p.lyrics || form.stylePrompt !== p.stylePrompt || form.rightsNotes !== p.rightsNotes);

  const save = () =>
    run(async () => {
      if (!projectId) return;
      await api.updateProject(projectId, { ...form, title: form.title.trim() || 'Untitled' });
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const generationJobs = detail?.jobs.filter((j) => j.type === 'generation') ?? [];
  const audio = detail?.assets.filter((a) => a.kind === 'audio') ?? [];

  return (
    <div className="screen">
      <h1>Song Studio</h1>
      <ProjectPicker projectId={projectId} setProjectId={setProjectId} allowCreate />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {p && (
        <>
          <Section
            title="Song"
            actions={
              <>
                {saved && <Badge tone="ok">Saved</Badge>}
                <button className="primary" disabled={!dirty || busy} onClick={save}>Save</button>
              </>
            }
          >
            <div className="grid2">
              <label className="field">
                <span>Title</span>
                <input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
              <label className="field">
                <span>Artist</span>
                <input value={form.artist} maxLength={200} onChange={(e) => setForm({ ...form, artist: e.target.value })} />
              </label>
            </div>
            <div className="grid2">
              <label className="field">
                <span>Lyrics</span>
                <textarea rows={14} value={form.lyrics} maxLength={20000} onChange={(e) => setForm({ ...form, lyrics: e.target.value })} />
              </label>
              <div className="stack">
                <label className="field">
                  <span>Style prompt</span>
                  <textarea rows={4} value={form.stylePrompt} maxLength={2000} onChange={(e) => setForm({ ...form, stylePrompt: e.target.value })} />
                </label>
                <label className="field">
                  <span>Rights-review notes (who wrote/owns lyrics, music, background; licence terms)</span>
                  <textarea rows={6} value={form.rightsNotes} maxLength={10000} onChange={(e) => setForm({ ...form, rightsNotes: e.target.value })} />
                </label>
              </div>
            </div>
          </Section>

          <Section
            title="Audio"
            actions={
              <>
                <button onClick={() => run(async () => { await api.importAsset(p.id, 'audio'); await load(); })}>Import audio file…</button>
                <button onClick={() => open('video', p.id)}>Open Video Studio</button>
              </>
            }
          >
            {audio.length === 0 && <p className="muted">No audio yet. Import a track you have rights to, or test the flow with the mock provider.</p>}
            <ul className="list">
              {audio.map((a) => (
                <li key={a.id}>
                  <label className="row">
                    <input
                      type="radio"
                      name="chosen-audio"
                      checked={p.chosenAudioAssetId === a.id}
                      onChange={() => run(async () => { await api.updateProject(p.id, { chosenAudioAssetId: a.id }); await load(); })}
                    />
                    <span>{a.originalName}</span>
                  </label>
                  <SourceBadge asset={a} />
                  <span className="muted"> {a.durationSec?.toFixed(1)}s · {fmtBytes(a.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Generate with a provider">
            <div className="row">
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                {providers.map((pr) => (
                  <option key={pr.id} value={pr.id} disabled={pr.state !== 'ready'}>
                    {pr.label}
                    {pr.state !== 'ready' ? ' (not configured)' : ''}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || dirty}
                title={dirty ? 'Save the song first' : undefined}
                onClick={() => run(async () => setPreview(await api.prepareGeneration(p.id, providerId)))}
              >
                Review generation…
              </button>
              {dirty && <span className="muted">Save changes first.</span>}
            </div>
            {generationJobs.length > 0 && (
              <ul className="list">
                {generationJobs.map((j) => (
                  <li key={j.id}>
                    <JobBadge job={j} /> {(j.input as { isMock?: boolean })?.isMock && <Badge tone="mock">MOCK</Badge>}
                    <span className="muted"> {fmtDate(j.createdAt)} · job {j.externalId ?? 'no ID recorded'}</span>
                    {(j.status === 'running' || j.status === 'needs_reconcile') && (
                      <button className="small" onClick={() => run(async () => { await api.refreshGeneration(j.id); await load(); })}>
                        {j.status === 'needs_reconcile' ? 'Reconcile (check status)' : 'Check status'}
                      </button>
                    )}
                    {j.error && <div className="muted small-text">{j.error}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {preview && p && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Approve generation">
            <h2>Approve generation</h2>
            {preview.isMock ? (
              <div className="banner mock">MOCK provider. Produces a placeholder sine tone locally. Not real music, no API call, no cost.</div>
            ) : (
              <div className="banner warn">This sends a real request to {preview.providerLabel} and may be billed.</div>
            )}
            <div className="kv">
              <span>Provider</span>
              <span>{preview.providerLabel}</span>
              <span>Title</span>
              <span>{preview.title}</span>
              <span>Generations</span>
              <span>{preview.count}</span>
              <span>Cost</span>
              <span>{preview.costText ?? 'Unknown. The provider has not published a cost this app can verify.'}</span>
              <span>Limit</span>
              <span>
                {preview.usedLast24h} of {preview.limitPer24h} used in the last 24 hours
              </span>
            </div>
            <h3>Style</h3>
            <pre className="exact">{preview.stylePrompt}</pre>
            <h3>Lyrics (exact)</h3>
            <pre className="exact">{preview.lyrics}</pre>
            <div className="row end">
              <button onClick={() => setPreview(null)}>Cancel</button>
              <button
                className="primary"
                disabled={busy || preview.usedLast24h + preview.count > preview.limitPer24h}
                onClick={() =>
                  run(async () => {
                    const token = preview.token;
                    setPreview(null);
                    await api.approveAndSubmitGeneration(p.id, token);
                    await load();
                  })
                }
              >
                Approve and submit {preview.count}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
