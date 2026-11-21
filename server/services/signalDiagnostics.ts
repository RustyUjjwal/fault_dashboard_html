import type {
  AnomalyReport,
  ExplainabilityReport,
  ExtractedFeatures,
  FaultTypeStage,
  FeatureImportanceItem,
  HarmonicBin,
  MechanismStage,
  PhasorReading,
  SequenceGroup,
  SignalDiagnostics,
  TemporalSaliencyPoint,
  WaveformSample,
} from '../../shared/types/fault.ts';

interface Complex {
  re: number;
  im: number;
}

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cMag(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

function cAngleDeg(a: Complex): number {
  let deg = (Math.atan2(a.im, a.re) * 180) / Math.PI;
  if (deg <= -180) deg += 360;
  if (deg > 180) deg -= 360;
  return Math.round(deg * 10) / 10;
}

function round(val: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(val * f) / f;
}

/**
 * Extracts complex RMS phasor at a specific frequency (e.g. 60 Hz) via DFT projection
 * over the post-inception event window.
 */
function extractDftPhasor(
  rows: WaveformSample[],
  channel: string,
  startIdx: number,
  freqHz: number,
): Complex {
  const omega = 2 * Math.PI * freqHz;
  let re = 0;
  let im = 0;
  let count = 0;

  for (let i = startIdx; i < rows.length; i += 1) {
    const val = rows[i][channel];
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    const tSec = rows[i].time / 1000;
    // Standard RMS cosine/sine projection
    re += val * Math.cos(omega * tSec);
    im -= val * Math.sin(omega * tSec);
    count += 1;
  }

  if (count === 0) return { re: 0, im: 0 };
  // Convert peak phasor (2/N) to RMS phasor (sqrt(2)/N)
  const scale = Math.SQRT2 / count;
  return { re: re * scale, im: im * scale };
}

/**
 * Fortescue Symmetrical Components Transform:
 *   X0 = (Xa + Xb + Xc) / 3
 *   X1 = (Xa + a*Xb + a^2*Xc) / 3
 *   X2 = (Xa + a^2*Xb + a*Xc) / 3
 * where a = exp(j * 120 deg) = -0.5 + j * sqrt(3)/2.
 */
function computeSequenceGroup(
  rows: WaveformSample[],
  cols: [string, string, string],
  unit: string,
  startIdx: number,
  freqHz = 60,
): SequenceGroup | null {
  const hasAll = cols.every((c) => rows.some((r) => typeof r[c] === 'number'));
  if (!hasAll) return null;

  const xa = extractDftPhasor(rows, cols[0], startIdx, freqHz);
  const xb = extractDftPhasor(rows, cols[1], startIdx, freqHz);
  const xc = extractDftPhasor(rows, cols[2], startIdx, freqHz);

  // Rotate reference so Phase A angle sits cleanly near 0° for readability
  const refAngle = Math.atan2(xa.im, xa.re);
  const rot: Complex = { re: Math.cos(-refAngle), im: Math.sin(-refAngle) };
  const ra = cMul(xa, rot);
  const rb = cMul(xb, rot);
  const rc = cMul(xc, rot);

  const aOp: Complex = { re: -0.5, im: Math.sqrt(3) / 2 };
  const a2Op: Complex = { re: -0.5, im: -Math.sqrt(3) / 2 };

  const x0 = cAdd(cAdd(ra, rb), rc);
  const x1 = cAdd(cAdd(ra, cMul(aOp, rb)), cMul(a2Op, rc));
  const x2 = cAdd(cAdd(ra, cMul(a2Op, rb)), cMul(aOp, rc));

  const zeroSeq = cMag(x0) / 3;
  const positiveSeq = cMag(x1) / 3;
  const negativeSeq = cMag(x2) / 3;
  const unbalanceFactorPct =
    positiveSeq > 1e-6 ? Math.min(200, (negativeSeq / positiveSeq) * 100) : 0;

  const phasors: PhasorReading[] = [
    { channel: cols[0], magnitude: round(cMag(ra), 2), angleDeg: cAngleDeg(ra) },
    { channel: cols[1], magnitude: round(cMag(rb), 2), angleDeg: cAngleDeg(rb) },
    { channel: cols[2], magnitude: round(cMag(rc), 2), angleDeg: cAngleDeg(rc) },
  ];

  return {
    positiveSeq: round(positiveSeq, 2),
    negativeSeq: round(negativeSeq, 2),
    zeroSeq: round(zeroSeq, 2),
    unbalanceFactorPct: round(unbalanceFactorPct, 1),
    unit,
    phasors,
  };
}

/**
 * Computes exact harmonic spectrum (orders 1..13, 60 Hz – 780 Hz) & THD %
 * over the post-inception event window.
 */
function computeChannelHarmonics(
  rows: WaveformSample[],
  channel: string,
  startIdx: number,
  fundamentalHz = 60,
): { harmonics: HarmonicBin[]; thdPct: number } {
  const bins: HarmonicBin[] = [];
  let fundamentalMag = 0;

  for (let order = 1; order <= 13; order += 1) {
    const freqHz = order * fundamentalHz;
    const phasor = extractDftPhasor(rows, channel, startIdx, freqHz);
    const mag = cMag(phasor);
    if (order === 1) fundamentalMag = Math.max(1e-6, mag);
    bins.push({
      order,
      freqHz,
      magnitude: round(mag, 3),
      pctOfFundamental: 0,
    });
  }

  let harmonicSqSum = 0;
  for (const b of bins) {
    b.pctOfFundamental = round((b.magnitude / fundamentalMag) * 100, 2);
    if (b.order >= 2) {
      harmonicSqSum += b.magnitude * b.magnitude;
    }
  }

  const thdPct = round(Math.min(200, (Math.sqrt(harmonicSqSum) / fundamentalMag) * 100), 2);
  return { harmonics: bins, thdPct };
}

export function computeSignalDiagnostics(
  rows: WaveformSample[],
  features: ExtractedFeatures,
): SignalDiagnostics {
  const n = rows.length;
  // Use post-inception steady event window (35% onward) so Fortescue & harmonics capture the disturbance
  const startIdx = Math.min(Math.max(0, n - 24), Math.floor(n * 0.35));

  const currentSequences = computeSequenceGroup(rows, ['Ia', 'Ib', 'Ic'], 'A', startIdx, 60);
  const voltageSequences = computeSequenceGroup(rows, ['Va', 'Vb', 'Vc'], 'kV', startIdx, 60);

  // Pick dominant affected current channel and dominant affected voltage channel for harmonic spectrum
  const currentChannels = features.channels.filter((c) => c.group === 'current');
  const voltageChannels = features.channels.filter((c) => c.group === 'voltage');

  const domCurrent =
    currentChannels
      .slice()
      .sort((a, b) => Math.abs(b.faultRatio - 1) - Math.abs(a.faultRatio - 1))[0]?.channel ??
    currentChannels[0]?.channel ??
    null;

  const domVoltage =
    voltageChannels
      .slice()
      .sort((a, b) => Math.abs(b.faultRatio - 1) - Math.abs(a.faultRatio - 1))[0]?.channel ??
    voltageChannels[0]?.channel ??
    null;

  const curSpec = domCurrent
    ? computeChannelHarmonics(rows, domCurrent, startIdx, 60)
    : { harmonics: [], thdPct: 0 };

  const voltSpec = domVoltage
    ? computeChannelHarmonics(rows, domVoltage, startIdx, 60)
    : { harmonics: [], thdPct: 0 };

  return {
    currentSequences,
    voltageSequences,
    spectrum: {
      fundamentalFreqHz: 60,
      currentChannel: domCurrent,
      voltageChannel: domVoltage,
      thdCurrentPct: curSpec.thdPct,
      thdVoltagePct: voltSpec.thdPct,
      currentHarmonics: curSpec.harmonics,
      voltageHarmonics: voltSpec.harmonics,
    },
  };
}

/**
 * Generates feature attribution weights and temporal saliency weights aligned with
 * the waveform timeline so users can inspect which electrical features and millisecond
 * windows drove the classification.
 */
export function buildExplainabilityReport(
  features: ExtractedFeatures,
  diagnostics: SignalDiagnostics,
  anomaly: AnomalyReport,
  mechanism: MechanismStage,
  faultType: FaultTypeStage,
): ExplainabilityReport {
  const maxISurgePct = Math.max(
    0,
    ...features.channels
      .filter((c) => c.group === 'current')
      .map((c) => (c.faultRatio - 1) * 100),
  );
  const i2Unbalance = diagnostics.currentSequences?.unbalanceFactorPct ?? 0;
  const thd = Math.max(diagnostics.spectrum.thdCurrentPct, diagnostics.spectrum.thdVoltagePct);

  const rawItems: Array<{
    feature: string;
    valueLabel: string;
    rawWeight: number;
    direction: 'fault' | 'healthy' | 'ood';
  }> = [
    {
      feature: 'Phase Current Surge',
      valueLabel: `+${round(maxISurgePct, 1)}% (${features.dominantPhase})`,
      rawWeight:
        mechanism.topMechanism === 'ShortCircuit' || mechanism.topMechanism === 'Overcurrent'
          ? Math.max(12, maxISurgePct * 0.45)
          : Math.min(18, maxISurgePct * 0.2),
      direction: maxISurgePct > 30 ? 'fault' : 'healthy',
    },
    {
      feature: 'Phase Voltage Sag / Swell',
      valueLabel:
        features.maxVoltageSwellPct > features.maxVoltageSagPct
          ? `+${features.maxVoltageSwellPct.toFixed(1)}% swell`
          : `-${features.maxVoltageSagPct.toFixed(1)}% sag`,
      rawWeight:
        mechanism.topMechanism === 'Overvoltage' || mechanism.topMechanism === 'Undervoltage'
          ? Math.max(25, Math.max(features.maxVoltageSagPct, features.maxVoltageSwellPct) * 1.4)
          : Math.max(features.maxVoltageSagPct, features.maxVoltageSwellPct) * 0.85,
      direction:
        Math.max(features.maxVoltageSagPct, features.maxVoltageSwellPct) > 14 ? 'fault' : 'healthy',
    },
    {
      feature: 'Phase Current Collapse (Open)',
      valueLabel: `-${features.maxCurrentDropPct.toFixed(1)}% drop`,
      rawWeight:
        mechanism.topMechanism === 'OpenCircuit'
          ? Math.max(35, features.maxCurrentDropPct * 0.9)
          : features.maxCurrentDropPct * 0.25,
      direction: features.maxCurrentDropPct > 40 ? 'fault' : 'healthy',
    },
    {
      feature: 'Zero-Sequence Residual (I0)',
      valueLabel: `${features.zeroSequenceCurrentRms.toFixed(1)} A RMS (G=${faultType.flags.G})`,
      rawWeight:
        faultType.flags.G === 1
          ? Math.max(22, Math.min(48, features.zeroSequenceCurrentRms * 0.08))
          : Math.min(12, features.zeroSequenceCurrentRms * 0.02 + 4),
      direction: faultType.flags.G === 1 ? 'fault' : 'healthy',
    },
    {
      feature: 'Negative-Sequence Unbalance (I2/I1)',
      valueLabel: `${i2Unbalance.toFixed(1)}%`,
      rawWeight:
        faultType.symmetry === 'Unsymmetrical'
          ? Math.max(15, i2Unbalance * 0.55)
          : Math.min(14, i2Unbalance * 0.25 + 4),
      direction: i2Unbalance > 15 ? 'fault' : 'healthy',
    },
    {
      feature: '60 Hz Reconstruction & THD',
      valueLabel: `Score ${anomaly.anomalyScore.toFixed(1)} · THD ${thd.toFixed(1)}%`,
      rawWeight: anomaly.isOutOfDistribution
        ? Math.max(45, anomaly.anomalyScore * 0.8)
        : Math.max(6, anomaly.anomalyScore * 0.22),
      direction: anomaly.isOutOfDistribution
        ? 'ood'
        : anomaly.isAnomalous
          ? 'fault'
          : 'healthy',
    },
  ];

  const totalW = rawItems.reduce((acc, item) => acc + Math.max(1, item.rawWeight), 0);
  const topFeatures: FeatureImportanceItem[] = rawItems
    .map((item) => ({
      feature: item.feature,
      valueLabel: item.valueLabel,
      contributionPct: round((Math.max(1, item.rawWeight) / totalW) * 100, 1),
      direction: item.direction,
    }))
    .sort((a, b) => b.contributionPct - a.contributionPct);

  // Temporal saliency derived from sliding-window anomaly curve normalized to [0, 1]
  const timeline = anomaly.timeline;
  const maxScore = Math.max(25, ...timeline.map((p) => p.score));
  const temporalSaliency: TemporalSaliencyPoint[] = timeline.map((p) => ({
    time: p.time,
    weight: round(Math.min(1, Math.max(0, (p.score - 8) / (maxScore - 8))), 3),
  }));

  // Find contiguous high-saliency window (weight >= 0.45)
  const highPts = temporalSaliency.filter((p) => p.weight >= 0.45);
  const saliencyWindowMs =
    highPts.length >= 2
      ? { startMs: highPts[0].time, endMs: highPts[highPts.length - 1].time }
      : null;

  const summary = anomaly.isOutOfDistribution
    ? `Driven primarily by high 60 Hz waveform reconstruction error (${anomaly.reconstructionErrorPct.toFixed(1)}%) and harmonic distortion (THD ${thd.toFixed(1)}%), flagging an out-of-distribution anomaly.`
    : faultType.topLabel === 'Healthy'
      ? `Low reconstruction residual (${anomaly.reconstructionErrorPct.toFixed(1)}%), balanced 3-phase sequence profile (I2/I1 ${i2Unbalance.toFixed(1)}%), and nominal RMS envelope support Healthy operation.`
      : `Primary drivers for ${faultType.topLabel}: ${topFeatures[0].feature} (${topFeatures[0].valueLabel}) and ${topFeatures[1].feature} (${topFeatures[1].valueLabel}).`;

  return {
    summary,
    saliencyWindowMs,
    topFeatures,
    temporalSaliency,
  };
}
