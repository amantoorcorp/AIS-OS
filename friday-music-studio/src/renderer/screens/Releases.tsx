import { useCallback, useEffect, useState } from 'react';
import { api, renderUrl } from '../api';
import type { ScreenProps } from '../App';
import { Badge, ErrorBanner, fmtBytes, fmtDate, ProjectPicker, Section, useAction } from '../components/common';
import { formatInZone } from '../../shared/defaults';
import type { ProjectDetail } from '../../shared/types';

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
