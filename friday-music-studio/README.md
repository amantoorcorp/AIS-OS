# Friday Music Studio

Desktop app for making lyric videos from original songs and, in later phases, publishing approved releases to YouTube.

**Status: Phase 1 only.** Local projects, audio import, lyric editor, preview and verified MP4 export work. Suno is **not connected** and YouTube is **not connected**. The mock provider makes sine-tone placeholders, not music.

## Run it

Needs Node 22+ and FFmpeg with libass (the `subtitles` filter) on your PATH, or pick it in Settings.

```bash
npm install
npm start          # build + launch
npm run dev        # Vite + watch + Electron
npm test           # unit + integration tests (real ffmpeg, real SQLite)
npm run typecheck
npm run build && npm run smoke   # drives the real app end to end
```

Headless Linux running as root (containers/CI): `FMS_NO_CHROMIUM_SANDBOX=1 xvfb-run -a npm run smoke`. That flag only works in unpackaged dev builds.

## Architecture

```
renderer (React, sandboxed)  ──window.friday.*──▶  preload (contextBridge, 26 fixed methods)
                                                         │ ipcRenderer.invoke
                                                         ▼
main process ── Zod-validates every payload, checks sender origin, redacts errors
   ├─ StudioService (no Electron deps, tested under Node)
   │    ├─ Store: node:sqlite (built into Electron 44's Node 24, no native rebuild)
   │    ├─ providers/: MusicProvider interface, MockProvider, SunoProvider (refuses: not configured)
   │    └─ render/ass.ts: lyric cues → ASS subtitles (same layout rules as the preview)
   ├─ fms-app://   serves the built UI with a strict CSP
   ├─ fms-media:// serves assets/renders by ID (never by path), with Range support for seeking
   └─ utilityProcess render worker ─▶ ffmpeg (argument arrays, shell: false)
```

Security choices:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `app.enableSandbox()`, no webviews, navigation and `window.open` blocked, all permission requests denied.
- The renderer never sends file paths, URLs or commands. Files come from native dialogs in main and are referenced by UUID afterwards. The FFmpeg binary is picked with a file dialog and checked before it's saved.
- All media served to the UI must resolve inside the app data directory.
- Errors are redacted (bearer tokens, OAuth codes and tokens, API keys, JWTs) before reaching the UI, the log file or a diagnostics export.
- No secrets exist yet. Phase 3 will store OAuth tokens with Electron `safeStorage` (Keychain / DPAPI / libsecret), never in localStorage, SQLite plaintext, logs or exports.

### Rendering: why FFmpeg + libass, not Remotion

- **FFmpeg + ASS subtitles** does exactly this job (static or looping background, timed text, H.264/AAC MP4) with one process and no browser. The preview and the export share `layoutCue()`, so the text sizing matches.
- **Remotion** would allow richer animation, but it bundles a headless Chromium render pipeline and **needs a paid company licence for for-profit organisations above its free-tier size**. Check remotion.dev/license before adopting it. Not needed for Phase 1.

Every export is checked with ffprobe after encoding: H.264, 1920×1080, an audio stream, and a duration within 0.75s of the audio. Anything else is marked failed. ffmpeg writes to `*.partial` and only renames the file once it passes, so a cancelled or crashed render never leaves a file that looks finished.

### Jobs and recovery

Jobs are stored in SQLite with type `generation | download | render | upload | schedule`. At startup, anything still `queued`/`running`:

- **render, download** → `interrupted` (local and reversible; the user can start it again; partial files are deleted)
- **generation, upload, schedule** → `needs_reconcile` (the outcome is unknown; check with the provider before any retry. Nothing resubmits automatically)

### Paid-generation guardrails (already enforced, tested with the mock)

1. **Review generation** shows the provider, exact lyrics, style, count, cost (or "unknown") and usage against the limit.
2. Approval returns a single-use token tied to a hash of title + lyrics + style + provider + count. Any edit after review invalidates it.
3. A configurable limit per rolling 24 hours (default 5) is checked at submit.
4. The job is saved as `running` **before** the network call. A timeout or network error becomes `needs_reconcile`, never a retry.
5. Mock output is stored as `source = mock_provider`, labelled MOCK everywhere, and **cannot pass final review**.

## Phase 1: what's built and verified

| Item | Status | Evidence |
|---|---|---|
| Electron shell, 6 screens | done | smoke test |
| Projects saved in SQLite, reopened after restart | done | integration + smoke |
| Audio/image/video import (copied into project, probed) | done | integration + smoke |
| Lyric editor: cues from lyrics, phrase-level start/end edits, set-to-playhead, merge, delete, tap-sync (T/Y), optional rough "spread evenly" | done | unit + smoke |
| Validation: max 2 lines, line length, overlaps, end after start, inside audio | done | unit |
| Preview with seeking, background, dim, watermark | done | smoke |
| 1920×1080 MP4 export: progress, cancel, error report, ffprobe check | done | integration (image, looping video, solid colour, cancel) + smoke |
| Final review checklist (blocks mock audio, requires rights notes, records SHA-256) | done | integration + smoke |
| Mock provider + approval gate + limit | done | integration |
| Suno adapter | **not built** (no official docs or credentials) | shows "Not configured" |
| YouTube OAuth / upload / scheduling | **not built** (Phases 3–4) | buttons disabled |

## Dependencies and licensing

| Package | Licence | Notes |
|---|---|---|
| electron 44 | MIT | ships Chromium (BSD-style plus third-party notices in `LICENSES.chromium.html`) |
| react, react-dom 19 | MIT | |
| zod 4 | MIT | IPC validation |
| vite 7, @vitejs/plugin-react, esbuild | MIT | build only |
| vitest, typescript, playwright-core | MIT / Apache-2.0 | dev only |
| **FFmpeg** (not bundled) | LGPL-2.1+, **GPL if built with x264/libass GPL parts** | Most builds with libx264 are GPL. Bundling one in a distributed app brings GPL obligations (source offer, licence text). Phase 1 avoids this by using the user's installed FFmpeg. Before you ship installers, decide: keep FFmpeg user-installed, or bundle an LGPL build with a non-GPL H.264 encoder, or accept GPL terms. |
| Fonts | depends on the font | The default is DejaVu Sans (free licence). Any font you set for branding must allow video embedding. |

## What's missing (you need to supply)

**Phase 2: Suno**

- Official, authorised API documentation from Suno: endpoints, auth, request/response schemas, job states, rate limits, pricing, webhooks, and the terms for commercial use of the output.
- An API key/account with that access.
- As far as I know, Suno has **not published an official public developer API**. The "Suno APIs" sold online are unofficial wrappers around the web app, which likely breaks Suno's terms and puts your account and your rights to the songs at risk. I won't build against one of those. If you get official access, send the docs and I'll write the adapter against `MusicProvider`.

**Phase 3: YouTube**

- A Google Cloud project with **YouTube Data API v3** enabled.
- An OAuth client of type **Desktop app** and a configured consent screen (test users added while it is in testing).
- Expect a **default quota of 10,000 units a day**. An upload costs about 1,600, so roughly 6 uploads a day.
- **Important:** videos uploaded through the API by an **unverified/unaudited API project are locked to private**. Public or scheduled releases need the project to pass Google's YouTube API compliance audit. Phase 3's private test upload works without that. Phase 4 scheduling needs it.
- The YouTube channel you'll publish to.

**Phase 4:** the audit above. Also check in YouTube Studio how the altered/synthetic content disclosure applies to AI-generated music. If the API can't set it reliably, the app will require a manual Studio check before scheduling.

## Honest business notes

- **7clouds** mostly promotes **licensed songs by real artists**, with labels and artists often paying or partnering. Its value is curation and audience, not lyric-video production. Copying the video format is easy. Building the audience is the hard part.
- **YouTube Partner Program** rules on *inauthentic / mass-produced, repetitive content* target exactly the "auto-generate songs and auto-post" pattern. Channels like that get demonetised. A human-curated catalogue with a real identity, a regular schedule and real promotion works better. That's why every step in this app has an approval gate.
- **Rights:** read Suno's current terms. Commercial use and ownership have depended on your plan at the time a track was generated. Keep your rights notes in each project; the release review requires them.
- Expect income to be small and slow. Treat it as a creative catalogue that might grow, not passive income.
