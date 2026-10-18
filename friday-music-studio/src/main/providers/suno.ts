// Placeholder for the Suno adapter (Phase 2). Intentionally has no endpoints,
// auth scheme, pricing or schema: those must come from official, authorised
// documentation supplied by the user. Every method refuses.

import type { ProviderInfo } from '../../shared/types';
import { ProviderNotConfiguredError, type MusicProvider, type ProviderJobStatus } from './types';

export class SunoProvider implements MusicProvider {
  readonly id = 'suno';
  readonly label = 'Suno';
  readonly isMock = false;

  async info(): Promise<ProviderInfo> {
    return {
      id: this.id,
      label: this.label,
      isMock: false,
      state: 'not_configured',
      detail: 'Not configured. Needs authorised API access and official documentation before an adapter can be built.',
    };
  }
  async validateConnection(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: 'Not configured.' };
  }
  async estimateCost(): Promise<string | null> {
    throw new ProviderNotConfiguredError(this.label);
  }
  async submitGeneration(): Promise<{ providerJobId: string }> {
    throw new ProviderNotConfiguredError(this.label);
  }
  async getJobStatus(): Promise<ProviderJobStatus> {
    throw new ProviderNotConfiguredError(this.label);
  }
  async downloadAudio(): Promise<{ mime: string }> {
    throw new ProviderNotConfiguredError(this.label);
  }
}
