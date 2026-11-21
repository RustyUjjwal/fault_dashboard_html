import {
  FAULT_TYPE_CATALOG,
  type FaultMechanism,
  type FaultTypeLabel,
  type RankedProbability,
} from '../../shared/types/fault.ts';
import type {
  InferenceInput,
  InferenceOutput,
  InferenceProvider,
} from './inferenceProvider.ts';

const MECHANISM_DISPLAY: Record<FaultMechanism, { title: string; label: string; description: string }> = {
  ShortCircuit: {
    title: 'SHORT CIRCUIT FAULT',
    label: 'ShortCircuit (Phase/Ground Contact)',
    description: 'Short-circuit contact event across phases or ground',
  },
  Overcurrent: {
    title: 'OVERCURRENT (NON-SHORT-CIRCUIT)',
    label: 'Overcurrent (Conductor Overload)',
    description: 'Per-phase overload current without short-circuit voltage collapse',
  },
  Overvoltage: {
    title: 'OVERVOLTAGE (NON-SHORT-CIRCUIT)',
    label: 'Overvoltage (Voltage Swell)',
    description: 'Per-phase voltage swell above nominal envelope',
  },
  Undervoltage: {
    title: 'UNDERVOLTAGE (NON-SHORT-CIRCUIT)',
    label: 'Undervoltage (Voltage Sag)',
    description: 'Per-phase voltage sag without fault current spike',
  },
  OpenCircuit: {
    title: 'OPEN CIRCUIT (NON-SHORT-CIRCUIT)',
    label: 'OpenCircuit (Broken Conductor)',
    description: 'Per-phase conductor discontinuity causing current collapse',
  },
  Healthy: {
    title: 'HEALTHY (NO FAULT)',
    label: 'Healthy (Balanced Nominal)',
    description: 'Balanced nominal 3-phase operation',
  },
};

interface CompactSoftmaxResponse {
  classProbabilities: Record<string, number>;
  anomalyScore?: number;
}

/**
 * Rolls up a single 28-class probability dictionary (e.g., from a PyTorch/sklearn/ONNX model)
 * into all 3 dashboard stages (Detection -> Mechanism -> FaultType).
 */
function rollupFromClassProbabilities(compact: CompactSoftmaxResponse): InferenceOutput {
  const rawEntries = FAULT_TYPE_CATALOG.map((entry) => {
    const raw = Number(compact.classProbabilities[entry.label] ?? 0);
    return { entry, raw: Number.isFinite(raw) && raw > 0 ? raw : 0 };
  });

  const total = rawEntries.reduce((acc, item) => acc + item.raw, 0) || 1;
  const normalized = rawEntries.map(({ entry, raw }) => ({
    entry,
    pct: Math.round((raw / total) * 1000) / 10,
  }));

  const healthyPct = normalized.find((n) => n.entry.label === 'Healthy')?.pct ?? 0;
  const faultProb = Math.round((100 - healthyPct) * 10) / 10;
  const faultDetected = faultProb >= 50;

  const detection = {
    faultDetected,
    statusLabel: faultDetected ? ('FAULT DETECTED' as const) : ('HEALTHY' as const),
    confidence: faultDetected ? faultProb : healthyPct,
    severity: !faultDetected
      ? ('nominal' as const)
      : faultProb >= 80
        ? ('critical' as const)
        : ('moderate' as const),
  };

  // Group probabilities by mechanism
  const mechTotals = new Map<FaultMechanism, number>();
  for (const mech of Object.keys(MECHANISM_DISPLAY) as FaultMechanism[]) {
    mechTotals.set(mech, 0);
  }
  for (const item of normalized) {
    mechTotals.set(
      item.entry.mechanism,
      Math.round(((mechTotals.get(item.entry.mechanism) ?? 0) + item.pct) * 10) / 10,
    );
  }

  const rankedMechanisms: RankedProbability[] = Array.from(mechTotals.entries())
    .map(([mech, prob]) => ({
      code: mech,
      label: MECHANISM_DISPLAY[mech].label,
      description: MECHANISM_DISPLAY[mech].description,
      probability: prob,
      mechanism: mech,
    }))
    .sort((a, b) => b.probability - a.probability);

  const topMech = rankedMechanisms[0].code as FaultMechanism;

  const mechanism = {
    isShortCircuit: topMech === 'ShortCircuit',
    topMechanism: topMech,
    topMechanismTitle: MECHANISM_DISPLAY[topMech].title,
    shortCircuitProbability: mechTotals.get('ShortCircuit') ?? 0,
    topProbability: rankedMechanisms[0].probability,
    probabilities: rankedMechanisms,
  };

  const rankedTypes: RankedProbability[] = normalized
    .map(({ entry, pct }) => ({
      code: entry.label,
      label: `${entry.label} (${entry.displayName})`,
      description: entry.description,
      probability: pct,
      mechanism: entry.mechanism,
      flags: { G: entry.G, A: entry.A, B: entry.B, C: entry.C },
    }))
    .sort((a, b) => b.probability - a.probability);

  const topEntry =
    FAULT_TYPE_CATALOG.find((e) => e.label === (rankedTypes[0].code as FaultTypeLabel)) ??
    FAULT_TYPE_CATALOG[0];

  const faultType = {
    topLabel: topEntry.label,
    topTitle:
      topEntry.label === 'Healthy'
        ? 'HEALTHY (NOMINAL)'
        : `${topEntry.label} — ${topEntry.displayName.toUpperCase()}`,
    topProbability: rankedTypes[0].probability,
    mechanism: topEntry.mechanism,
    symmetry: topEntry.symmetry,
    flags: { G: topEntry.G, A: topEntry.A, B: topEntry.B, C: topEntry.C },
    probabilities: rankedTypes.slice(0, 8),
  };

  return {
    detection,
    mechanism,
    faultType,
    anomalyScoreOverride:
      typeof compact.anomalyScore === 'number' && Number.isFinite(compact.anomalyScore)
        ? compact.anomalyScore
        : undefined,
  };
}

/**
 * Ready-to-use HTTP adapter for your external ML model service (FastAPI, Flask,
 * TorchServe, ONNX Runtime, scikit-learn, etc.).
 *
 * Accepts EITHER:
 *  A) Simple 28-class dictionary: { classProbabilities: { LG_A: 0.91, ... }, anomalyScore?: 84.2 }
 *     (automatically rolled up into Detection, Mechanism, FaultType, and OOD anomaly triage!)
 *  B) Full structured payload: { detection, mechanism, faultType, anomaly? }
 */
export class ExternalMlHttpProvider implements InferenceProvider {
  readonly id = 'external-ml-http';
  readonly name = 'External ML Service (HTTP)';
  readonly kind = 'external-http' as const;
  readonly description =
    'Forwards extracted features and waveforms to ML_SERVICE_URL. Accepts either a compact 28-class probability dictionary (+ optional anomalyScore) or full stage output.';

  private get endpointUrl(): string {
    return (process.env.ML_SERVICE_URL ?? '').trim();
  }

  isAvailable(): boolean {
    return this.endpointUrl.length > 0;
  }

  async predict(input: InferenceInput): Promise<InferenceOutput> {
    const url = this.endpointUrl;
    if (!url) {
      throw new Error(
        'ML_SERVICE_URL is not configured. Set ML_SERVICE_URL in your environment to enable external ML inference.',
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = (process.env.ML_SERVICE_API_KEY ?? '').trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: input.fileName,
          features: input.features,
          waveform: input.waveform,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `External ML endpoint responded with HTTP ${response.status}: ${body.slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as Partial<InferenceOutput> &
        Partial<CompactSoftmaxResponse>;

      if (payload.classProbabilities && typeof payload.classProbabilities === 'object') {
        return rollupFromClassProbabilities({
          classProbabilities: payload.classProbabilities,
          anomalyScore: payload.anomalyScore,
        });
      }

      if (!payload.detection || !payload.mechanism || !payload.faultType) {
        throw new Error(
          'External ML response must contain either { classProbabilities } or { detection, mechanism, faultType }.',
        );
      }

      return payload as InferenceOutput;
    } finally {
      clearTimeout(timeout);
    }
  }
}
