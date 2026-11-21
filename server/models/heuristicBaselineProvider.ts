import {
  FAULT_TYPE_CATALOG,
  type ChannelSummary,
  type FaultMechanism,
  type FaultTaxonomyEntry,
  type RankedProbability,
} from '../../shared/types/fault.ts';
import type {
  InferenceInput,
  InferenceOutput,
  InferenceProvider,
} from './inferenceProvider.ts';

const MECHANISM_META: Record<
  FaultMechanism,
  { title: string; label: string; description: string }
> = {
  ShortCircuit: {
    title: 'SHORT CIRCUIT',
    label: 'ShortCircuit (Phase / Ground)',
    description: 'High fault current surge accompanied by phase voltage sag across faulted phase(s)',
  },
  Overcurrent: {
    title: 'OVERCURRENT',
    label: 'Overcurrent (Phase Overload)',
    description: 'Sustained overcurrent on phase(s) without bolted short-circuit voltage collapse',
  },
  Overvoltage: {
    title: 'OVERVOLTAGE',
    label: 'Overvoltage (Phase Swell)',
    description: 'Phase voltage swell exceeding nominal steady-state envelope',
  },
  Undervoltage: {
    title: 'UNDERVOLTAGE',
    label: 'Undervoltage (Phase Sag)',
    description: 'Phase voltage dip without elevated short-circuit fault current',
  },
  OpenCircuit: {
    title: 'OPEN CIRCUIT',
    label: 'OpenCircuit (Open Phase)',
    description: 'Phase discontinuity causing phase current collapse near zero',
  },
  Healthy: {
    title: 'HEALTHY',
    label: 'Healthy (Balanced Nominal)',
    description: 'All three phases operating within normal current and voltage envelopes',
  },
};

function softmaxPercentages(scores: Array<{ code: string; score: number }>): Map<string, number> {
  const maxScore = Math.max(...scores.map((s) => s.score));
  const exps = scores.map((s) => ({
    code: s.code,
    val: Math.exp(s.score - maxScore),
  }));
  const sum = exps.reduce((acc, item) => acc + item.val, 0);
  const result = new Map<string, number>();
  for (const item of exps) {
    result.set(item.code, Math.round((item.val / sum) * 1000) / 10);
  }
  return result;
}

function getChannel(channels: ChannelSummary[], name: string): ChannelSummary | undefined {
  return channels.find((c) => c.channel === name);
}

/**
 * Physics-informed 3-stage baseline classifier aligned with fault_type_table.m:
 * - Step 1: Fault Detection (Healthy vs Fault Detected)
 * - Step 2: Mechanism Triage (ShortCircuit vs Overcurrent / Overvoltage / Undervoltage / OpenCircuit / Healthy)
 * - Step 3: Specific Fault Type & Conductor Matrix (28 classes with {G, A, B, C})
 */
export class PhysicsBaselineProvider implements InferenceProvider {
  readonly id = 'physics-baseline';
  readonly name = 'Physics Signal Baseline (28-Class)';
  readonly kind = 'baseline' as const;
  readonly description =
    'Deterministic 3-stage classifier aligned with fault_type_table.m: detects anomalies, separates ShortCircuit from Overcurrent/Overvoltage/Undervoltage/OpenCircuit, and predicts exact {G, A, B, C} fault classes.';

  isAvailable(): boolean {
    return true;
  }

  async predict(input: InferenceInput): Promise<InferenceOutput> {
    const { features } = input;
    const chIa = getChannel(features.channels, 'Ia');
    const chIb = getChannel(features.channels, 'Ib');
    const chIc = getChannel(features.channels, 'Ic');
    const chVa = getChannel(features.channels, 'Va');
    const chVb = getChannel(features.channels, 'Vb');
    const chVc = getChannel(features.channels, 'Vc');

    // Per-phase current surge, current drop (open circuit), voltage sag, and voltage swell
    const iRatio = {
      A: chIa?.faultRatio ?? 1,
      B: chIb?.faultRatio ?? 1,
      C: chIc?.faultRatio ?? 1,
    };
    const vRatio = {
      A: chVa?.faultRatio ?? 1,
      B: chVb?.faultRatio ?? 1,
      C: chVc?.faultRatio ?? 1,
    };

    const iSurge = {
      A: Math.max(0, iRatio.A - 1),
      B: Math.max(0, iRatio.B - 1),
      C: Math.max(0, iRatio.C - 1),
    };
    const iDrop = {
      A: Math.max(0, 1 - iRatio.A),
      B: Math.max(0, 1 - iRatio.B),
      C: Math.max(0, 1 - iRatio.C),
    };
    const vSag = {
      A: Math.max(0, 1 - vRatio.A),
      B: Math.max(0, 1 - vRatio.B),
      C: Math.max(0, 1 - vRatio.C),
    };
    const vSwell = {
      A: Math.max(0, vRatio.A - 1),
      B: Math.max(0, vRatio.B - 1),
      C: Math.max(0, vRatio.C - 1),
    };

    const maxISurge = Math.max(iSurge.A, iSurge.B, iSurge.C);
    const maxIDrop = Math.max(iDrop.A, iDrop.B, iDrop.C);
    const maxVSag = Math.max(vSag.A, vSag.B, vSag.C);
    const maxVSwell = Math.max(vSwell.A, vSwell.B, vSwell.C);

    const avgNominalI =
      ((chIa?.preFaultRms ?? 1) + (chIb?.preFaultRms ?? 1) + (chIc?.preFaultRms ?? 1)) / 3;
    const zeroSeqRatio =
      avgNominalI > 1e-6 ? features.zeroSequenceCurrentRms / avgNominalI : 0;

    // Overall disturbance strength across all mechanisms
    const anomalyMagnitude = Math.max(
      maxISurge,
      maxIDrop * 1.4,
      maxVSag * 2.2,
      maxVSwell * 2.2,
    );

    const isFault =
      maxISurge > 0.35 || maxIDrop > 0.42 || maxVSag > 0.14 || maxVSwell > 0.14;

    // Step 1: Fault Detection
    const detectionConfidence = isFault
      ? Math.min(99.6, Math.max(84.5, Math.round((86 + Math.min(13.5, anomalyMagnitude * 4.5)) * 10) / 10))
      : Math.min(99.4, Math.max(89.0, Math.round((98.8 - anomalyMagnitude * 22) * 10) / 10));

    const detection = {
      faultDetected: isFault,
      statusLabel: isFault ? ('FAULT DETECTED' as const) : ('HEALTHY' as const),
      confidence: detectionConfidence,
      severity: !isFault
        ? ('nominal' as const)
        : maxISurge > 1.8 || maxVSag > 0.35 || maxIDrop > 0.72 || maxVSwell > 0.25
          ? ('critical' as const)
          : ('moderate' as const),
    };

    // Step 2: Mechanism Triage (ShortCircuit vs Overcurrent / Overvoltage / Undervoltage / OpenCircuit / Healthy)
    // ShortCircuit signature: high current surge AND substantial voltage sag on faulted phase(s)
    const scOverlap = Math.max(
      Math.min(iSurge.A, vSag.A * 5),
      Math.min(iSurge.B, vSag.B * 5),
      Math.min(iSurge.C, vSag.C * 5),
    );
    const shortCircuitScore = isFault
      ? (maxISurge > 1.2 && maxVSag > 0.18 ? 4.8 : 0.4) +
        scOverlap * 2.4 +
        maxISurge * 0.7 +
        maxVSag * 2.8 -
        maxIDrop * 3.0 -
        maxVSwell * 1.5
      : -4.0;

    // Overcurrent signature: elevated current surge WITHOUT severe voltage collapse
    const overcurrentScore = isFault
      ? (maxISurge > 0.4 && maxVSag < 0.16 ? 5.2 : 0.6) +
        maxISurge * 2.1 -
        maxVSag * 5.2 -
        maxIDrop * 3.0 -
        maxVSwell * 2.5
      : -3.5;

    // Overvoltage signature: significant voltage swell without fault current surge or collapse
    const overvoltageScore = isFault
      ? (maxVSwell > 0.15 && maxISurge < 0.55 ? 5.5 : 0.2) +
        maxVSwell * 8.5 -
        maxISurge * 2.4 -
        maxVSag * 3.5 -
        maxIDrop * 2.5
      : -3.5;

    // Undervoltage signature: significant voltage sag WITHOUT fault current spike
    const undervoltageScore = isFault
      ? (maxVSag > 0.15 && maxISurge < 0.45 ? 5.4 : 0.2) +
        maxVSag * 7.5 -
        maxISurge * 2.8 -
        maxIDrop * 2.2 -
        maxVSwell * 3.5
      : -3.5;

    // OpenCircuit signature: phase current collapses near zero (iDrop > 0.45)
    const openCircuitScore = isFault
      ? (maxIDrop > 0.45 ? 5.8 : -0.5) +
        maxIDrop * 6.5 -
        maxISurge * 1.8 -
        maxVSag * 2.0
      : -3.5;

    const healthyScore = isFault ? -4.5 : 7.0;

    const mechanismRawScores: Array<{ code: FaultMechanism; score: number }> = [
      { code: 'ShortCircuit', score: shortCircuitScore },
      { code: 'Overcurrent', score: overcurrentScore },
      { code: 'Overvoltage', score: overvoltageScore },
      { code: 'Undervoltage', score: undervoltageScore },
      { code: 'OpenCircuit', score: openCircuitScore },
      { code: 'Healthy', score: healthyScore },
    ];

    const mechProbMap = softmaxPercentages(mechanismRawScores);
    const rankedMechanisms: RankedProbability[] = mechanismRawScores
      .map((m) => ({
        code: m.code,
        label: MECHANISM_META[m.code].label,
        description: MECHANISM_META[m.code].description,
        probability: mechProbMap.get(m.code) ?? 0,
        mechanism: m.code,
      }))
      .sort((a, b) => b.probability - a.probability);

    const topMech = rankedMechanisms[0];
    const topMechCode = topMech.code as FaultMechanism;

    const mechanism = {
      isShortCircuit: topMechCode === 'ShortCircuit',
      topMechanism: topMechCode,
      topMechanismTitle: MECHANISM_META[topMechCode].title,
      shortCircuitProbability: mechProbMap.get('ShortCircuit') ?? 0,
      topProbability: topMech.probability,
      probabilities: rankedMechanisms,
    };

    // Step 3: Exact 28-Class Fault Type Classification matching fault_type_table.m
    // Compute phase activity score per mechanism
    const scoreEntry = (entry: FaultTaxonomyEntry): number => {
      const mechBase =
        mechanismRawScores.find((m) => m.code === entry.mechanism)?.score ?? -4;

      if (entry.mechanism === 'Healthy') {
        return mechBase;
      }

      // Measure how strongly each phase matches the target mechanism's physical signature
      const phaseMetric = (phase: 'A' | 'B' | 'C'): number => {
        switch (entry.mechanism) {
          case 'ShortCircuit':
            return iSurge[phase] * 1.15 + vSag[phase] * 3.2;
          case 'Overcurrent':
            return iSurge[phase] * 2.4;
          case 'Overvoltage':
            return vSwell[phase] * 8.0;
          case 'Undervoltage':
            return vSag[phase] * 8.0;
          case 'OpenCircuit':
            return iDrop[phase] * 6.5;
          default:
            return 0;
        }
      };

      const mA = phaseMetric('A');
      const mB = phaseMetric('B');
      const mC = phaseMetric('C');
      const maxM = Math.max(mA, mB, mC, 0.25);
      const activeThreshold = maxM * 0.45;

      const obsA = mA >= activeThreshold ? 1 : 0;
      const obsB = mB >= activeThreshold ? 1 : 0;
      const obsC = mC >= activeThreshold ? 1 : 0;

      // Exact conductor pattern match bonus/penalty
      const matchA = entry.A === obsA ? 2.1 : -2.4;
      const matchB = entry.B === obsB ? 2.1 : -2.4;
      const matchC = entry.C === obsC ? 2.1 : -2.4;

      // Ground contact check for ShortCircuit rows (G=1 vs G=0)
      let groundTerm = 0;
      if (entry.mechanism === 'ShortCircuit') {
        const hasGroundCurrent = zeroSeqRatio > 0.28;
        if (entry.G === 1) {
          groundTerm = hasGroundCurrent ? 2.6 : -2.2;
        } else {
          groundTerm = hasGroundCurrent ? -2.0 : 2.3;
        }
      }

      // Slight continuous signal alignment tie-breaker
      const continuousAlignment =
        (entry.A ? mA : -mA * 0.4) +
        (entry.B ? mB : -mB * 0.4) +
        (entry.C ? mC : -mC * 0.4);

      return mechBase * 1.25 + matchA + matchB + matchC + groundTerm + continuousAlignment * 0.35;
    };

    const classRawScores = FAULT_TYPE_CATALOG.map((entry) => ({
      code: entry.label,
      entry,
      score: scoreEntry(entry),
    }));

    const classProbMap = softmaxPercentages(
      classRawScores.map((c) => ({ code: c.code, score: c.score })),
    );

    const rankedFaultTypes: RankedProbability[] = classRawScores
      .map(({ entry }) => ({
        code: entry.label,
        label: `${entry.label} (${entry.displayName})`,
        description: entry.description,
        probability: classProbMap.get(entry.label) ?? 0,
        mechanism: entry.mechanism,
        flags: { G: entry.G, A: entry.A, B: entry.B, C: entry.C },
      }))
      .sort((a, b) => b.probability - a.probability);

    const topEntry =
      FAULT_TYPE_CATALOG.find((e) => e.label === rankedFaultTypes[0].code) ??
      FAULT_TYPE_CATALOG[0];

    const faultType = {
      topLabel: topEntry.label,
      topTitle:
        topEntry.label === 'Healthy'
          ? 'HEALTHY (NOMINAL)'
          : `${topEntry.label} — ${topEntry.displayName.toUpperCase()}`,
      topProbability: rankedFaultTypes[0].probability,
      mechanism: topEntry.mechanism,
      symmetry: topEntry.symmetry,
      flags: {
        G: topEntry.G,
        A: topEntry.A,
        B: topEntry.B,
        C: topEntry.C,
      },
      probabilities: rankedFaultTypes.slice(0, 8),
    };

    return {
      detection,
      mechanism,
      faultType,
    };
  }
}
