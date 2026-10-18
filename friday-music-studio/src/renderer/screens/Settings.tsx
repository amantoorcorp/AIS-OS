import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, ErrorBanner, Section, useAction } from '../components/common';
import type { Settings, ToolStatus } from '../../shared/types';
import { BrandingEditor } from '../components/BrandingEditor';

export function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [tz, setTz] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();

  const refreshTools = () => run(async () => setTools(await api.checkTools()));
  useEffect(() => {
    void run(async () => {
      const st = await api.getSettings();
      setS(st);
      setTz(st.defaultTimezone);
      setTools(await api.checkTools());
    });
  }, [run]);

  const save = (patch: Parameters<typeof api.updateSettings>[0]) =>
    run(async () => {
      setS(await api.updateSettings(patch));
      setNote('Saved.');
      setTimeout(() => setNote(null), 1500);
    });

  if (!s) return <div className="screen"><ErrorBanner error={error} /></div>;
  return (
    <div className="screen">
      <h1>Settings</h1>
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {note && <div className="banner ok">{note}</div>}
      <Section title="FFmpeg" actions={<button onClick={refreshTools} disabled={busy}>Re-check</button>}>
        <p>
          {tools?.ok ? <Badge tone="ok">Ready</Badge> : <Badge tone="bad">Not ready</Badge>} <span className="muted">{tools?.version}</span>
        </p>
        {tools?.error && <p className="muted">{tools.error}</p>}
        <div className="kv">
          <span>ffmpeg</span>
          <code>{s.ffmpegPath ?? 'ffmpeg (from PATH)'}</code>
          <span className="row">
            <button onClick={() => run(async () => { setS(await api.pickBinary('ffmpeg')); await refreshTools(); })}>Locate…</button>
            <button onClick={() => run(async () => { setS(await api.resetBinary('ffmpeg')); await refreshTools(); })}>Use PATH</button>
          </span>
          <span>ffprobe</span>
          <code>{s.ffprobePath ?? 'ffprobe (from PATH)'}</code>
          <span className="row">
            <button onClick={() => run(async () => setS(await api.pickBinary('ffprobe')))}>Locate…</button>
            <button onClick={() => run(async () => setS(await api.resetBinary('ffprobe')))}>Use PATH</button>
          </span>
        </div>
        <p className="muted small-text">FFmpeg is not bundled. Install it yourself (it must include libass). See README for licensing notes.</p>
      </Section>
      <Section title="Defaults">
        <label className="field">
          <span>Default timezone (IANA)</span>
          <span className="row">
            <input value={tz} onChange={(e) => setTz(e.target.value)} />
            <button onClick={() => save({ defaultTimezone: tz.trim() })}>Save</button>
          </span>
        </label>
        <label className="field">
          <span>Default artist</span>
          <input defaultValue={s.defaultArtist} onBlur={(e) => e.target.value !== s.defaultArtist && save({ defaultArtist: e.target.value })} maxLength={200} />
        </label>
        <label className="field">
          <span>Generation limit (per rolling 24 hours, all providers)</span>
          <input
            type="number"
            min={0}
            max={50}
            defaultValue={s.generationLimitPer24h}
            onBlur={(e) => save({ generationLimitPer24h: Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0))) })}
          />
        </label>
      </Section>
      <Section title="Default branding for new projects">
        <BrandingEditor value={s.defaultBranding} onSave={(b) => save({ defaultBranding: b })} />
      </Section>
      <Section title="Diagnostics">
        <p className="muted small-text">Exports app version, tool status and job states with secrets redacted. No lyrics, notes or file paths.</p>
        <button onClick={() => run(async () => { const f = await api.exportDiagnostics(); if (f) setNote(`Saved ${f}`); })}>Export diagnostics…</button>
      </Section>
    </div>
  );
}
