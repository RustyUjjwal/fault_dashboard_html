export type FaultMechanism =
  | 'Healthy'
  | 'ShortCircuit'
  | 'Overcurrent'
  | 'Overvoltage'
  | 'Undervoltage'
  | 'OpenCircuit';

export type FaultTypeLabel =
  | 'Healthy'
  | 'LG_A'
  | 'LG_B'
  | 'LG_C'
  | 'LL_AB'
  | 'LL_BC'
  | 'LL_CA'
  | 'LLG_AB'
  | 'LLG_BC'
  | 'LLG_CA'
  | 'LLL'
  | 'LLLG'
  | 'Overcurrent_A'
  | 'Overcurrent_B'
  | 'Overcurrent_C'
  | 'Overcurrent_ABC'
  | 'Overvoltage_A'
  | 'Overvoltage_B'
  | 'Overvoltage_C'
  | 'Overvoltage_ABC'
  | 'Undervoltage_A'
  | 'Undervoltage_B'
  | 'Undervoltage_C'
  | 'Undervoltage_ABC'
  | 'OpenCircuit_A'
  | 'OpenCircuit_B'
  | 'OpenCircuit_C'
  | 'OpenCircuit_ABC';

export interface ConductorFlags {
  G: 0 | 1;
  A: 0 | 1;
  B: 0 | 1;
  C: 0 | 1;
}

export interface FaultTaxonomyEntry extends ConductorFlags {
  label: FaultTypeLabel;
  mechanism: FaultMechanism;
  displayName: string;
  symmetry: 'Balanced' | 'Symmetrical' | 'Unsymmetrical' | 'Per-Phase';
  description: string;
}

/**
 * Canonical 28-row fault taxonomy synced directly with fault_type_table.m:
 * 1 Healthy + 11 ShortCircuit + 4 non-short-circuit mechanisms x 4 rows (A, B, C, ABC).
 */
export const FAULT_TYPE_CATALOG: readonly FaultTaxonomyEntry[] = [
  { label: 'Healthy', mechanism: 'Healthy', G: 0, A: 0, B: 0, C: 0, displayName: 'Healthy (Nominal)', symmetry: 'Balanced', description: 'Balanced nominal 3-phase power system operation' },

  { label: 'LG_A', mechanism: 'ShortCircuit', G: 1, A: 1, B: 0, C: 0, displayName: 'Line-to-Ground (Phase A)', symmetry: 'Unsymmetrical', description: 'Single-phase short circuit from Phase A to Ground' },
  { label: 'LG_B', mechanism: 'ShortCircuit', G: 1, A: 0, B: 1, C: 0, displayName: 'Line-to-Ground (Phase B)', symmetry: 'Unsymmetrical', description: 'Single-phase short circuit from Phase B to Ground' },
  { label: 'LG_C', mechanism: 'ShortCircuit', G: 1, A: 0, B: 0, C: 1, displayName: 'Line-to-Ground (Phase C)', symmetry: 'Unsymmetrical', description: 'Single-phase short circuit from Phase C to Ground' },
  { label: 'LL_AB', mechanism: 'ShortCircuit', G: 0, A: 1, B: 1, C: 0, displayName: 'Line-to-Line (A-B)', symmetry: 'Unsymmetrical', description: 'Ungrounded phase-to-phase short circuit between A and B' },
  { label: 'LL_BC', mechanism: 'ShortCircuit', G: 0, A: 0, B: 1, C: 1, displayName: 'Line-to-Line (B-C)', symmetry: 'Unsymmetrical', description: 'Ungrounded phase-to-phase short circuit between B and C' },
  { label: 'LL_CA', mechanism: 'ShortCircuit', G: 0, A: 1, B: 0, C: 1, displayName: 'Line-to-Line (C-A)', symmetry: 'Unsymmetrical', description: 'Ungrounded phase-to-phase short circuit between C and A' },
  { label: 'LLG_AB', mechanism: 'ShortCircuit', G: 1, A: 1, B: 1, C: 0, displayName: 'Double Line-Ground (A-B-G)', symmetry: 'Unsymmetrical', description: 'Two-phase-to-ground short circuit across Phases A, B, and Ground' },
  { label: 'LLG_BC', mechanism: 'ShortCircuit', G: 1, A: 0, B: 1, C: 1, displayName: 'Double Line-Ground (B-C-G)', symmetry: 'Unsymmetrical', description: 'Two-phase-to-ground short circuit across Phases B, C, and Ground' },
  { label: 'LLG_CA', mechanism: 'ShortCircuit', G: 1, A: 1, B: 0, C: 1, displayName: 'Double Line-Ground (C-A-G)', symmetry: 'Unsymmetrical', description: 'Two-phase-to-ground short circuit across Phases C, A, and Ground' },
  { label: 'LLL', mechanism: 'ShortCircuit', G: 0, A: 1, B: 1, C: 1, displayName: 'Three-Phase Short Circuit (LLL)', symmetry: 'Symmetrical', description: 'Symmetrical three-phase ungrounded short circuit' },
  { label: 'LLLG', mechanism: 'ShortCircuit', G: 1, A: 1, B: 1, C: 1, displayName: 'Three-Phase Ground (LLLG)', symmetry: 'Symmetrical', description: 'Symmetrical three-phase bolted ground short circuit' },

  { label: 'Overcurrent_A', mechanism: 'Overcurrent', G: 0, A: 1, B: 0, C: 0, displayName: 'Overcurrent (Phase A)', symmetry: 'Per-Phase', description: 'Sustained overload current on Phase A without short-circuit voltage collapse' },
  { label: 'Overcurrent_B', mechanism: 'Overcurrent', G: 0, A: 0, B: 1, C: 0, displayName: 'Overcurrent (Phase B)', symmetry: 'Per-Phase', description: 'Sustained overload current on Phase B without short-circuit voltage collapse' },
  { label: 'Overcurrent_C', mechanism: 'Overcurrent', G: 0, A: 0, B: 0, C: 1, displayName: 'Overcurrent (Phase C)', symmetry: 'Per-Phase', description: 'Sustained overload current on Phase C without short-circuit voltage collapse' },
  { label: 'Overcurrent_ABC', mechanism: 'Overcurrent', G: 0, A: 1, B: 1, C: 1, displayName: 'Overcurrent (3-Phase ABC)', symmetry: 'Per-Phase', description: 'Balanced three-phase overload condition across A, B, and C' },

  { label: 'Overvoltage_A', mechanism: 'Overvoltage', G: 0, A: 1, B: 0, C: 0, displayName: 'Overvoltage (Phase A)', symmetry: 'Per-Phase', description: 'Voltage swell event on Phase A above nominal envelope' },
  { label: 'Overvoltage_B', mechanism: 'Overvoltage', G: 0, A: 0, B: 1, C: 0, displayName: 'Overvoltage (Phase B)', symmetry: 'Per-Phase', description: 'Voltage swell event on Phase B above nominal envelope' },
  { label: 'Overvoltage_C', mechanism: 'Overvoltage', G: 0, A: 0, B: 0, C: 1, displayName: 'Overvoltage (Phase C)', symmetry: 'Per-Phase', description: 'Voltage swell event on Phase C above nominal envelope' },
  { label: 'Overvoltage_ABC', mechanism: 'Overvoltage', G: 0, A: 1, B: 1, C: 1, displayName: 'Overvoltage (3-Phase ABC)', symmetry: 'Per-Phase', description: 'Three-phase voltage swell across A, B, and C' },

  { label: 'Undervoltage_A', mechanism: 'Undervoltage', G: 0, A: 1, B: 0, C: 0, displayName: 'Undervoltage (Phase A)', symmetry: 'Per-Phase', description: 'Voltage dip on Phase A without fault current surge' },
  { label: 'Undervoltage_B', mechanism: 'Undervoltage', G: 0, A: 0, B: 1, C: 0, displayName: 'Undervoltage (Phase B)', symmetry: 'Per-Phase', description: 'Voltage dip on Phase B without fault current surge' },
  { label: 'Undervoltage_C', mechanism: 'Undervoltage', G: 0, A: 0, B: 0, C: 1, displayName: 'Undervoltage (Phase C)', symmetry: 'Per-Phase', description: 'Voltage dip on Phase C without fault current surge' },
  { label: 'Undervoltage_ABC', mechanism: 'Undervoltage', G: 0, A: 1, B: 1, C: 1, displayName: 'Undervoltage (3-Phase ABC)', symmetry: 'Per-Phase', description: 'Balanced three-phase undervoltage dip across A, B, and C' },

  { label: 'OpenCircuit_A', mechanism: 'OpenCircuit', G: 0, A: 1, B: 0, C: 0, displayName: 'Open Circuit (Phase A)', symmetry: 'Per-Phase', description: 'Broken conductor or open fuse on Phase A with current collapse' },
  { label: 'OpenCircuit_B', mechanism: 'OpenCircuit', G: 0, A: 0, B: 1, C: 0, displayName: 'Open Circuit (Phase B)', symmetry: 'Per-Phase', description: 'Broken conductor or open fuse on Phase B with current collapse' },
  { label: 'OpenCircuit_C', mechanism: 'OpenCircuit', G: 0, A: 0, B: 0, C: 1, displayName: 'Open Circuit (Phase C)', symmetry: 'Per-Phase', description: 'Broken conductor or open fuse on Phase C with current collapse' },
  { label: 'OpenCircuit_ABC', mechanism: 'OpenCircuit', G: 0, A: 1, B: 1, C: 1, displayName: 'Open Circuit (3-Phase ABC)', symmetry: 'Per-Phase', description: 'Three-phase conductor disconnect / breaker open across A, B, and C' },
] as const;

export interface WaveformSample {
  time: number;
  Ia?: number;
  Ib?: number;
  Ic?: number;
  Va?: number;
  Vb?: number;
  Vc?: number;
  [key: string]: number | undefined;
}

export interface ChannelSummary {
  channel: string;
  label: string;
  unit: string;
  group: 'current' | 'voltage' | 'other';
  min: number;
  max: number;
  mean: number;
  rms: number;
  stdDev: number;
  peakToPeak: number;
  preFaultRms: number;
  faultRms: number;
  faultRatio: number;
}

export interface ExtractedFeatures {
  fileName: string;
  rowCount: number;
  samplingRateHz: number;
  durationMs: number;
  faultInceptionMs: number | null;
  zeroSequenceCurrentRms: number;
  phaseCurrentImbalancePct: number;
  maxVoltageSagPct: number;
  maxVoltageSwellPct: number;
  maxCurrentDropPct: number;
  peakFaultCurrent: number;
  dominantPhase: string;
  channels: ChannelSummary[];
  availableColumns: string[];
}

export interface DetectionStage {
  faultDetected: boolean;
  statusLabel: 'FAULT DETECTED' | 'UNKNOWN ANOMALY' | 'HEALTHY';
  confidence: number;
  severity: 'critical' | 'moderate' | 'nominal';
}

export interface AnomalyMetric {
  id: string;
  label: string;
  score: number;
  valueLabel: string;
  status: 'normal' | 'elevated' | 'anomalous';
}

export interface AnomalyTimelinePoint {
  time: number;
  score: number;
  reconstructionError: number;
}

export interface AnomalyReport {
  isAnomalous: boolean;
  isOutOfDistribution: boolean;
  anomalyScore: number;
  threshold: number;
  statusLabel: 'Normal Baseline' | 'Known Fault Signature' | 'Unknown / Out-of-Distribution Anomaly';
  summary: string;
  reconstructionErrorPct: number;
  metrics: AnomalyMetric[];
  timeline: AnomalyTimelinePoint[];
}

export interface RankedProbability {
  code: string;
  label: string;
  description: string;
  probability: number;
  mechanism?: FaultMechanism;
  flags?: ConductorFlags;
}

export interface MechanismStage {
  isShortCircuit: boolean;
  topMechanism: FaultMechanism;
  topMechanismTitle: string;
  shortCircuitProbability: number;
  topProbability: number;
  probabilities: RankedProbability[];
}

export interface FaultTypeStage {
  topLabel: FaultTypeLabel;
  topTitle: string;
  topProbability: number;
  mechanism: FaultMechanism;
  symmetry: FaultTaxonomyEntry['symmetry'];
  flags: ConductorFlags;
  probabilities: RankedProbability[];
}

export interface PhasorReading {
  channel: string;
  magnitude: number;
  angleDeg: number;
}

export interface SequenceGroup {
  positiveSeq: number;
  negativeSeq: number;
  zeroSeq: number;
  unbalanceFactorPct: number;
  unit: string;
  phasors: PhasorReading[];
}

export interface HarmonicBin {
  order: number;
  freqHz: number;
  magnitude: number;
  pctOfFundamental: number;
}

export interface SpectrumAnalysis {
  fundamentalFreqHz: number;
  currentChannel: string | null;
  voltageChannel: string | null;
  thdCurrentPct: number;
  thdVoltagePct: number;
  currentHarmonics: HarmonicBin[];
  voltageHarmonics: HarmonicBin[];
}

export interface SignalDiagnostics {
  currentSequences: SequenceGroup | null;
  voltageSequences: SequenceGroup | null;
  spectrum: SpectrumAnalysis;
}

export interface FeatureImportanceItem {
  feature: string;
  valueLabel: string;
  contributionPct: number;
  direction: 'fault' | 'healthy' | 'ood';
}

export interface TemporalSaliencyPoint {
  time: number;
  weight: number;
}

export interface ExplainabilityReport {
  summary: string;
  saliencyWindowMs: { startMs: number; endMs: number } | null;
  topFeatures: FeatureImportanceItem[];
  temporalSaliency: TemporalSaliencyPoint[];
}

export interface InferenceMetadata {
  providerId: string;
  providerName: string;
  inferenceTimeMs: number;
  analyzedAt: string;
}

export interface FaultAnalysisResponse {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  detection: DetectionStage;
  anomaly: AnomalyReport;
  mechanism: MechanismStage;
  faultType: FaultTypeStage;
  features: ExtractedFeatures;
  diagnostics: SignalDiagnostics;
  explainability: ExplainabilityReport;
  waveform: WaveformSample[];
  inference: InferenceMetadata;
}

export interface BatchEvalRow {
  fileName: string;
  trueLabel: string | null;
  trueMechanism: string | null;
  predictedLabel: string;
  predictedMechanism: string;
  confidence: number;
  anomalyScore: number;
  isOod: boolean;
  correct: boolean | null;
  mechanismCorrect: boolean | null;
}

export interface BatchEvalResponse {
  totalFiles: number;
  labeledFiles: number;
  accuracyPct: number | null;
  mechanismAccuracyPct: number | null;
  macroF1Pct: number | null;
  confusionLabels: string[];
  confusionMatrix: number[][];
  rows: BatchEvalRow[];
}

export interface SampleScenario {
  id: string;
  fileName: string;
  title: string;
  faultLabel: FaultTypeLabel | 'UnknownAnomaly';
  mechanism: FaultMechanism | 'Unknown';
  description: string;
}

export interface ModelProviderInfo {
  id: string;
  name: string;
  kind: 'baseline' | 'external-http';
  available: boolean;
  description: string;
  endpointConfigured?: boolean;
}
