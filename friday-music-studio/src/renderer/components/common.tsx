import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Asset, Job, Project } from '../../shared/types';

export function ErrorBanner({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      <span>{error}</span>
      {onClose && <button className="link" onClick={onClose}>Dismiss</button>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'mock' | 'muted'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function SourceBadge({ asset }: { asset: Asset }) {
  if (asset.source === 'mock_provider') return <Badge tone="mock">MOCK · not real music</Badge>;
  if (asset.source === 'provider') return <Badge tone="ok">{asset.providerId}</Badge>;
  return <Badge tone="muted">Imported</Badge>;
}

const JOB_TONE: Record<Job['status'], 'ok' | 'warn' | 'bad' | 'muted'> = {
  queued: 'muted',
  running: 'warn',
  succeeded: 'ok',
  failed: 'bad',
  cancelled: 'muted',
  interrupted: 'warn',
  needs_reconcile: 'bad',
};
export function JobBadge({ job }: { job: Job }) {
  return <Badge tone={JOB_TONE[job.status]}>{job.status.replace('_', ' ')}</Badge>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        <div className="row">{actions}</div>
      </header>
      {children}
    </section>
  );
}

/** Runs an async action, capturing errors for display. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function ProjectPicker({ projectId, setProjectId, allowCreate }: { projectId: string | null; setProjectId: (id: string | null) => void; allowCreate?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState('');
  const { error, setError, run } = useAction();
  const load = useCallback(() => api.listProjects().then(setProjects).catch((e: Error) => setError(e.message)), [setError]);
  useEffect(() => {
    void load();
  }, [load, projectId]);

  return (
    <div className="picker">
      <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)} aria-label="Project">
        <option value="">Select a project…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
            {p.artist ? ` · ${p.artist}` : ''}
          </option>
        ))}
      </select>
      {allowCreate && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            void run(async () => {
              const p = await api.createProject(title.trim(), '');
              setTitle('');
              await load();
              setProjectId(p.id);
            });
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New song title" maxLength={200} />
          <button type="submit" disabled={!title.trim()}>Create project</button>
        </form>
      )}
      <ErrorBanner error={error} onClose={() => setError(null)} />
    </div>
  );
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}
