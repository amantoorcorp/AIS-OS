// Clearly labelled MOCK provider. Produces sine-tone placeholder audio
// locally with ffmpeg. No network, no cost. Assets it creates carry
// source = 'mock_provider' and can never pass final release review.

import { randomUUID } from 'node:crypto';
import { synthesizeTone } from '../render/ffmpeg';
import type { ProviderInfo } from '../../shared/types';
import type { GenerationRequest, MusicProvider, ProviderJobStatus } from './types';

interface MockJob {
  count: number;
  submittedAt: number;
}

export class MockProvider implements MusicProvider {
  readonly id = 'mock';
  readonly label = 'Mock provider (test tones, not real music)';
  readonly isMock = true;
  private jobs = new Map<string, MockJob>();

  constructor(private readonly ffmpegPath: () => string) {}

  async info(): Promise<ProviderInfo> {
    return { id: this.id, label: this.label, isMock: true, state: 'ready', detail: 'Offline. Generates placeholder sine tones for testing the workflow.' };
  }

  async validateConnection() {
    return { ok: true, detail: 'Mock provider is always available.' };
  }

  async estimateCost(): Promise<string | null> {
    return 'Free (mock, no API call)';
  }

  async submitGeneration(req: GenerationRequest) {
    const providerJobId = `mock-${randomUUID()}`;
    this.jobs.set(providerJobId, { count: req.count, submittedAt: Date.now() });
    return { providerJobId };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderJobStatus> {
    const job = this.jobs.get(providerJobId);
    if (!job) {
      // Mock jobs live in memory; after a restart the outcome is genuinely unknown.
      return { state: 'unknown', trackIds: [], message: 'Mock job not found (mock state resets on restart).' };
    }
    if (Date.now() - job.submittedAt < 1500) return { state: 'running', trackIds: [], message: null };
    return { state: 'complete', trackIds: Array.from({ length: job.count }, (_, i) => `track-${i + 1}`), message: null };
  }

  async downloadAudio(_providerJobId: string, trackId: string, destPath: string) {
    const n = Number(trackId.replace('track-', '')) || 1;
    await synthesizeTone(this.ffmpegPath(), destPath, 20, 330 + 110 * n);
    return { mime: 'audio/mpeg' };
  }
}
