import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { Badge, ErrorBanner, fmtDate, JobBadge, Section } from '../components/common';
import type { DashboardSummary } from '../../shared/types';

export function Dashboard({ open }: ScreenProps) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.dashboard().then(setData).catch((e: Error) => setError(e.message));
    void load();
    return api.onJobsChanged(load);
  }, []);

  return (
    <div className="screen">
      <h1>Dashboard</h1>
      <ErrorBanner error={error} />
      {data && (
        <>
          {!data.ffmpeg.ok && (
            <div className="banner error">
              FFmpeg is not ready: {data.ffmpeg.error} <button className="link" onClick={() => open('settings')}>Open Settings</button>
            </div>
          )}
          <div className="grid3">
            <div className="stat">
              <div className="stat-num">{data.projectCount}</div>
              <div className="muted">Projects</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.attentionJobs.length}</div>
              <div className="muted">Jobs needing attention</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.ffmpeg.ok ? 'Ready' : 'Missing'}</div>
              <div className="muted">FFmpeg {data.ffmpeg.version ?? ''}</div>
            </div>
          </div>
          <Section title="Recent projects" actions={<button onClick={() => open('song')}>New project</button>}>
            {data.recentProjects.length === 0 && <p className="muted">No projects yet. Start one in Song Studio.</p>}
            <ul className="list">
              {data.recentProjects.map((p) => (
                <li key={p.id}>
                  <button className="link" onClick={() => open('song', p.id)}>{p.title}</button>
                  <span className="muted"> {p.artist} · updated {fmtDate(p.updatedAt)}</span>
                  <span className="row">
                    <button className="small" onClick={() => open('video', p.id)}>Video</button>
                    <button className="small" onClick={() => open('releases', p.id)}>Release</button>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Needs attention">
            {data.attentionJobs.length === 0 && <p className="muted">Nothing. All jobs finished cleanly.</p>}
            <ul className="list">
              {data.attentionJobs.map((j) => (
                <li key={j.id}>
                  <JobBadge job={j} /> <strong>{j.type}</strong> <span className="muted">{fmtDate(j.updatedAt)}</span>
                  {j.error && <div className="muted small-text">{j.error}</div>}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Integrations">
            <ul className="list">
              {data.providers.map((p) => (
                <li key={p.id}>
                  <strong>{p.label}</strong>{' '}
                  {p.isMock ? <Badge tone="mock">MOCK</Badge> : p.state === 'ready' ? <Badge tone="ok">Connected</Badge> : <Badge tone="bad">Not configured</Badge>}
                </li>
              ))}
              <li>
                <strong>YouTube</strong> <Badge tone="bad">Not configured</Badge> <span className="muted">Phase 3</span>
              </li>
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
