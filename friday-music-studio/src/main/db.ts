// SQLite persistence via Node's built-in node:sqlite (no native rebuild for
// Electron). All SQL uses bound parameters.

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BRANDING, DEFAULT_SETTINGS } from '../shared/defaults';
import type {
  Approval,
  ApprovalKind,
  Asset,
  AssetKind,
  AssetSource,
  Branding,
  Job,
  JobStatus,
  JobType,
  LyricCue,
  Project,
  RenderOutput,
  RenderProbe,
  Settings,
} from '../shared/types';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    lyrics TEXT NOT NULL DEFAULT '',
    style_prompt TEXT NOT NULL DEFAULT '',
    provider_id TEXT,
    provider_job_id TEXT,
    chosen_audio_asset_id TEXT,
    background_asset_id TEXT,
    rights_notes TEXT NOT NULL DEFAULT '',
    branding_json TEXT NOT NULL,
    youtube_video_id TEXT,
    release_at_utc TEXT,
    release_timezone TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (kind IN ('audio','image','video')),
    source TEXT NOT NULL CHECK (source IN ('local_import','mock_provider','provider')),
    provider_id TEXT,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_sec REAL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE lyric_cues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    idx INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX lyric_cues_project ON lyric_cues(project_id, idx);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    type TEXT NOT NULL CHECK (type IN ('generation','download','render','upload','schedule')),
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    external_id TEXT,
    error TEXT,
    input_json TEXT NOT NULL DEFAULT 'null',
    output_json TEXT NOT NULL DEFAULT 'null',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX jobs_project ON jobs(project_id, created_at);
  CREATE TABLE render_outputs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    job_id TEXT NOT NULL REFERENCES jobs(id),
    stored_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    verified INTEGER NOT NULL,
    probe_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
];

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const parse = (v: unknown): unknown => (v == null ? null : JSON.parse(String(v)));
const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  close() {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- projects ----------

  private toProject(r: Row): Project {
    return {
      id: String(r.id),
      title: String(r.title),
      artist: String(r.artist),
      lyrics: String(r.lyrics),
      stylePrompt: String(r.style_prompt),
      providerId: str(r.provider_id),
      providerJobId: str(r.provider_job_id),
      chosenAudioAssetId: str(r.chosen_audio_asset_id),
      backgroundAssetId: str(r.background_asset_id),
      rightsNotes: String(r.rights_notes),
      branding: { ...DEFAULT_BRANDING, ...(parse(r.branding_json) as Partial<Branding>) },
      youtubeVideoId: str(r.youtube_video_id),
      releaseAtUtc: str(r.release_at_utc),
      releaseTimezone: String(r.release_timezone),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  createProject(input: { title: string; artist: string; branding: Branding; timezone: string }): Project {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO projects (id, title, artist, branding_json, release_timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.title, input.artist, JSON.stringify(input.branding), input.timezone, t, t);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ? AND archived = 0').get(id) as Row | undefined;
    return r ? this.toProject(r) : null;
  }

  listProjects(): Project[] {
    return (this.db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC').all() as Row[]).map((r) =>
      this.toProject(r),
    );
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'title' | 'artist' | 'lyrics' | 'stylePrompt' | 'rightsNotes' | 'chosenAudioAssetId' | 'backgroundAssetId' | 'branding' | 'providerId' | 'providerJobId' | 'youtubeVideoId'>>,
  ): Project {
    const cols: Record<string, string> = {
      title: 'title',
      artist: 'artist',
      lyrics: 'lyrics',
      stylePrompt: 'style_prompt',
      rightsNotes: 'rights_notes',
      chosenAudioAssetId: 'chosen_audio_asset_id',
      backgroundAssetId: 'background_asset_id',
      branding: 'branding_json',
      providerId: 'provider_id',
      providerJobId: 'provider_job_id',
      youtubeVideoId: 'youtube_video_id',
    };
    const sets: string[] = [];
    const vals: Array<string | null> = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = cols[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(k === 'branding' ? JSON.stringify(v) : (v as string | null));
    }
    sets.push('updated_at = ?');
    vals.push(now());
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    const p = this.getProject(id);
    if (!p) throw new Error('Project not found');
    return p;
  }

  archiveProject(id: string) {
    this.db.prepare('UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?').run(now(), id);
  }

  // ---------- assets ----------

  private toAsset(r: Row): Asset {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      kind: r.kind as AssetKind,
      source: r.source as AssetSource,
      providerId: str(r.provider_id),
      originalName: String(r.original_name),
      mime: String(r.mime),
      sizeBytes: Number(r.size_bytes),
      durationSec: num(r.duration_sec),
      width: num(r.width),
      height: num(r.height),
      createdAt: String(r.created_at),
    };
  }

  addAsset(a: Omit<Asset, 'id' | 'createdAt'> & { id?: string; storedPath: string }): Asset {
    const id = a.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO assets (id, project_id, kind, source, provider_id, original_name, stored_path, mime, size_bytes, duration_sec, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, a.projectId, a.kind, a.source, a.providerId, a.originalName, a.storedPath, a.mime, a.sizeBytes, a.durationSec, a.width, a.height, now());
    return this.getAsset(id)!;
  }

  getAsset(id: string): Asset | null {
    const r = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toAsset(r) : null;
  }

  getAssetPath(id: string): { asset: Asset; storedPath: string } | null {
    const r = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    return r ? { asset: this.toAsset(r), storedPath: String(r.stored_path) } : null;
  }

  listAssets(projectId: string): Asset[] {
    return (this.db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(projectId) as Row[]).map((r) =>
      this.toAsset(r),
    );
  }

  // ---------- cues ----------

  replaceCues(projectId: string, cues: LyricCue[]) {
    this.tx(() => {
      this.db.prepare('DELETE FROM lyric_cues WHERE project_id = ?').run(projectId);
      const ins = this.db.prepare('INSERT INTO lyric_cues (id, project_id, idx, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?, ?)');
      cues.forEach((c, i) => ins.run(c.id, projectId, i, c.startMs, c.endMs, c.text));
      this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
    });
  }

  listCues(projectId: string): LyricCue[] {
    return (this.db.prepare('SELECT * FROM lyric_cues WHERE project_id = ? ORDER BY idx').all(projectId) as Row[]).map((r) => ({
      id: String(r.id),
      startMs: Number(r.start_ms),
      endMs: Number(r.end_ms),
      text: String(r.text),
    }));
  }

  // ---------- jobs ----------

  private toJob(r: Row): Job {
    return {
      id: String(r.id),
      projectId: str(r.project_id),
      type: r.type as JobType,
      status: r.status as JobStatus,
      progress: Number(r.progress),
      externalId: str(r.external_id),
      error: str(r.error),
      input: parse(r.input_json),
      output: parse(r.output_json),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  createJob(type: JobType, projectId: string | null, input: unknown, status: JobStatus = 'queued'): Job {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare('INSERT INTO jobs (id, project_id, type, status, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, type, status, JSON.stringify(input ?? null), t, t);
    return this.getJob(id)!;
  }

  getJob(id: string): Job | null {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toJob(r) : null;
  }

  updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'progress' | 'externalId' | 'error' | 'output'>>): Job {
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    if (patch.status !== undefined) (sets.push('status = ?'), vals.push(patch.status));
    if (patch.progress !== undefined) (sets.push('progress = ?'), vals.push(patch.progress));
    if (patch.externalId !== undefined) (sets.push('external_id = ?'), vals.push(patch.externalId));
    if (patch.error !== undefined) (sets.push('error = ?'), vals.push(patch.error));
    if (patch.output !== undefined) (sets.push('output_json = ?'), vals.push(JSON.stringify(patch.output)));
    sets.push('updated_at = ?');
    vals.push(now());
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return this.getJob(id)!;
  }

  listJobs(projectId?: string, limit = 100): Job[] {
    const rows = projectId
      ? this.db.prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
      : this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
    return (rows as Row[]).map((r) => this.toJob(r));
  }

  jobsNeedingAttention(): Job[] {
    return (
      this.db
        .prepare(`SELECT * FROM jobs WHERE status IN ('needs_reconcile','interrupted','failed') ORDER BY updated_at DESC LIMIT 20`)
        .all() as Row[]
    ).map((r) => this.toJob(r));
  }

  countJobsSince(type: JobType, sinceIso: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ? AND created_at >= ?').get(type, sinceIso) as { n: number };
    return Number(r.n);
  }

  /**
   * Called once at startup. Anything left queued/running was cut off by an
   * exit or crash. Local work (render, download) becomes "interrupted" and
   * may be restarted by the user. External, possibly-billed or irreversible
   * work (generation, upload, schedule) becomes "needs_reconcile": its
   * outcome must be checked with the provider before anything is retried.
   */
  recoverJobsAfterRestart(): { interrupted: Job[]; reconcile: Job[] } {
    const stale = (this.db.prepare(`SELECT * FROM jobs WHERE status IN ('queued','running')`).all() as Row[]).map((r) => this.toJob(r));
    const interrupted: Job[] = [];
    const reconcile: Job[] = [];
    for (const j of stale) {
      if (j.type === 'render' || j.type === 'download') {
        interrupted.push(this.updateJob(j.id, { status: 'interrupted', error: 'The app closed before this job finished.' }));
      } else {
        reconcile.push(
          this.updateJob(j.id, {
            status: 'needs_reconcile',
            error: 'Outcome unknown after restart. Check with the provider before retrying.',
          }),
        );
      }
    }
    return { interrupted, reconcile };
  }

  // ---------- renders ----------

  private toRender(r: Row): RenderOutput {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      jobId: String(r.job_id),
      fileName: String(r.file_name),
      sizeBytes: Number(r.size_bytes),
      verified: Number(r.verified) === 1,
      probe: parse(r.probe_json) as RenderProbe | null,
      createdAt: String(r.created_at),
    };
  }

  addRender(r: { projectId: string; jobId: string; storedPath: string; fileName: string; sizeBytes: number; verified: boolean; probe: RenderProbe }): RenderOutput {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO render_outputs (id, project_id, job_id, stored_path, file_name, size_bytes, verified, probe_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, r.projectId, r.jobId, r.storedPath, r.fileName, r.sizeBytes, r.verified ? 1 : 0, JSON.stringify(r.probe), now());
    return this.getRender(id)!.output;
  }

  getRender(id: string): { output: RenderOutput; storedPath: string } | null {
    const r = this.db.prepare('SELECT * FROM render_outputs WHERE id = ?').get(id) as Row | undefined;
    return r ? { output: this.toRender(r), storedPath: String(r.stored_path) } : null;
  }

  listRenders(projectId: string): RenderOutput[] {
    return (this.db.prepare('SELECT * FROM render_outputs WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Row[]).map((r) =>
      this.toRender(r),
    );
  }

  // ---------- approvals ----------

  addApproval(projectId: string, kind: ApprovalKind, snapshot: unknown): Approval {
    const id = randomUUID();
    const t = now();
    this.db.prepare('INSERT INTO approvals (id, project_id, kind, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, kind, JSON.stringify(snapshot), t);
    return { id, projectId, kind, snapshot, createdAt: t };
  }

  listApprovals(projectId: string): Approval[] {
    return (this.db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Row[]).map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      kind: r.kind as ApprovalKind,
      snapshot: parse(r.snapshot_json),
      createdAt: String(r.created_at),
    }));
  }

  // ---------- settings ----------

  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as Array<{ key: string; value_json: string }>;
    const stored: Record<string, unknown> = {};
    for (const r of rows) stored[r.key] = JSON.parse(r.value_json);
    return { ...DEFAULT_SETTINGS, ...stored } as Settings;
  }

  setSettings(patch: Partial<Settings>) {
    const up = this.db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json');
    this.tx(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) up.run(k, JSON.stringify(v));
    });
  }
}
