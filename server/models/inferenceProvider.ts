import type {
  AnomalyReport,
  DetectionStage,
  ExtractedFeatures,
  FaultTypeStage,
  MechanismStage,
  ModelProviderInfo,
  WaveformSample,
} from '../../shared/types/fault.ts';

export interface InferenceInput {
  fileName: string;
  features: ExtractedFeatures;
  waveform: WaveformSample[];
}

export interface InferenceOutput {
  detection: DetectionStage;
  mechanism: MechanismStage;
  faultType: FaultTypeStage;
  anomalyScoreOverride?: number;
  anomaly?: AnomalyReport;
}

/**
 * Modular ML inference contract.
 * Implement this interface to plug in a local ONNX Runtime model,
 * TensorFlow.js graph, Python FastAPI microservice, or TorchServe endpoint.
 */
export interface InferenceProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'baseline' | 'external-http';
  readonly description: string;
  isAvailable(): boolean;
  predict(input: InferenceInput): Promise<InferenceOutput>;
}

export class ModelRegistry {
  private readonly providers = new Map<string, InferenceProvider>();
  private defaultProviderId: string | null = null;

  register(provider: InferenceProvider, isDefault = false): void {
    this.providers.set(provider.id, provider);
    if (isDefault || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  resolve(providerId?: string): InferenceProvider {
    if (providerId) {
      const requested = this.providers.get(providerId);
      if (requested && requested.isAvailable()) {
        return requested;
      }
    }

    // Prefer external ML endpoint automatically when configured and no explicit ID was requested
    if (!providerId) {
      for (const provider of this.providers.values()) {
        if (provider.kind === 'external-http' && provider.isAvailable()) {
          return provider;
        }
      }
    }

    if (this.defaultProviderId) {
      const fallback = this.providers.get(this.defaultProviderId);
      if (fallback) return fallback;
    }

    throw new Error('No inference provider is registered.');
  }

  list(): ModelProviderInfo[] {
    return Array.from(this.providers.values()).map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      available: provider.isAvailable(),
      description: provider.description,
      endpointConfigured:
        provider.kind === 'external-http' ? provider.isAvailable() : undefined,
    }));
  }
}
