// Render worker. Runs in an Electron utilityProcess so FFmpeg orchestration
// never blocks the main process. One render at a time per worker.

import { runRender, RenderCancelledError, type RenderSpec } from './ffmpeg';

type InMsg = { type: 'start'; jobId: string; spec: RenderSpec } | { type: 'cancel'; jobId: string };
export type WorkerOutMsg =
  | { type: 'progress'; jobId: string; progress: number }
  | { type: 'done'; jobId: string; result: Awaited<ReturnType<typeof runRender>> }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId: string; message: string };

interface Port {
  on(event: 'message', listener: (e: { data: InMsg }) => void): void;
  postMessage(msg: WorkerOutMsg): void;
}

const port = (process as unknown as { parentPort?: Port }).parentPort;
if (!port) throw new Error('render worker must run inside an Electron utilityProcess');

const running = new Map<string, AbortController>();

port.on('message', ({ data }) => {
  if (data.type === 'cancel') {
    running.get(data.jobId)?.abort();
    return;
  }
  const { jobId, spec } = data;
  const ac = new AbortController();
  running.set(jobId, ac);
  let lastSent = -1;
  runRender(
    spec,
    (p) => {
      // Throttle to whole percents.
      const pct = Math.floor(p * 100);
      if (pct !== lastSent) {
        lastSent = pct;
        port.postMessage({ type: 'progress', jobId, progress: p });
      }
    },
    ac.signal,
  )
    .then((result) => port.postMessage({ type: 'done', jobId, result }))
    .catch((err: unknown) => {
      if (err instanceof RenderCancelledError) port.postMessage({ type: 'cancelled', jobId });
      else port.postMessage({ type: 'error', jobId, message: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => running.delete(jobId));
});
