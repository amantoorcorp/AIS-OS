// Music provider contract. A real adapter is only added once official,
// authorised documentation and credentials exist. Nothing here assumes any
// provider's endpoints, auth format, pricing, limits or response schema.

import type { ProviderInfo } from '../../shared/types';

export interface GenerationRequest {
  title: string;
  lyrics: string;
  stylePrompt: string;
  count: number;
}

export type ProviderJobState = 'pending' | 'running' | 'complete' | 'failed' | 'unknown';

export interface ProviderJobStatus {
  state: ProviderJobState;
  /** Provider-side track identifiers ready for download. */
  trackIds: string[];
  message: string | null;
}

export interface MusicProvider {
  readonly id: string;
  readonly label: string;
  /** Mock output must always be labelled as such in the UI and data. */
  readonly isMock: boolean;
  info(): Promise<ProviderInfo>;
  validateConnection(): Promise<{ ok: boolean; detail: string }>;
  /** Null when the provider does not publish a cost we can rely on. */
  estimateCost(req: GenerationRequest): Promise<string | null>;
  /** Returns the provider's job ID. Never called twice for one approval. */
  submitGeneration(req: GenerationRequest): Promise<{ providerJobId: string }>;
  getJobStatus(providerJobId: string): Promise<ProviderJobStatus>;
  downloadAudio(providerJobId: string, trackId: string, destPath: string): Promise<{ mime: string }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(label: string) {
    super(`${label} is not configured. Official API documentation and credentials are required first.`);
  }
}
