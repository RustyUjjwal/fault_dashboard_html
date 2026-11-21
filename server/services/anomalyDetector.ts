import type {
  AnomalyMetric,
  AnomalyReport,
  AnomalyTimelinePoint,
  ExtractedFeatures,
  FaultTypeStage,
  MechanismStage,
  WaveformSample,
} from '../../shared/types/fault.ts';

const ANOMALY_THRESHOLD = 25.0;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

/**
 * Fits a fundamental sinusoidal model y(t) ≈ a*cos(w*t) + b*sin(w*t) + c
 * on the pre-fault baseline window and measures how strongly subsequent windows
 * deviate (reconstruction error / residual, analogous to an autoencoder anomaly detector).
 */
function fitFundamentalModel(
  rows: WaveformSample[],
  channel: string,
  preCount: number,
  freqHz = 60,
): { a: number; b: number; c: number; baselineRms: number } {
  const omega = 2 * Math.PI * freqHz;
  let sCC = 0;
  let sSS = 0;
  let sCS = 0;
  let sC = 0;
  let sS = 0;
  let sY = 0;
  let sYC = 0;
  let sYS = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < Math.min(preCount, rows.length); i += 1) {
    const y = rows[i][channel];
    if (typeof y !== 'number' || !Number.isFinite(y)) continue;
    const tSec = rows[i].time / 1000;
    const cVal = Math.cos(omega * tSec);
    const sVal = Math.sin(omega * tSec);

    sCC += cVal * cVal;
    sSS += sVal * sVal;
    sCS += cVal * sVal;
    sC += cVal;
    sS += sVal;
    sY += y;
    sYC += y * cVal;
    sYS += y * sVal;
    sumSq += y * y;
    count += 1;
  }

  if (count < 4) {
    return { a: 0, b: 0, c: 0, baselineRms: 1 };
  }

  const cMean = sY / count;
  // Centered 2x2 least squares for (a, b)
  const m11 = sCC - (sC * sC) / count;
  const m22 = sSS - (sS * sS) / count;
  const m12 = sCS - (sC * sS) / count;
  const r1 = sYC - (sY * sC) / count;
  const r2 = sYS - (sY * sS) / count;
  const det = m11 * m22 - m12 * m12;

  let a = 0;
  let b = 0;
  if (Math.abs(det) > 1e-9) {
    a = (r1 * m22 - r2 * m12) / det;
    b = (m11 * r2 - m12 * r1) / det;
  }
  const c = cMean - (a * sC + b * sS) / count;

  const baselineRms = Math.max(1e-6, Math.sqrt(sumSq / count));
  return { a, b, c, baselineRms };
}

export interface AnomalyEvaluation {
  report: AnomalyReport;
  highFrequencyResidualPct: number;
  dcDriftPct: number;
}

/**
 * Unsupervised / model-agnostic signal anomaly detector.
 * Evaluates:
 * 1. Fundamental waveform reconstruction error (catches faults AND unknown harmonic/sensor glitches)
 * 2. Envelope RMS shift (current surges, current drops, voltage sags/swells)
 * 3. High-frequency / non-sinusoidal impulse & DC-offset distortion (strong OOD indicator)
 * 4. 3-phase symmetry & zero-sequence residual
 */
export function evaluateSignalAnomalies(
  rows: WaveformSample[],
  features: ExtractedFeatures,
  mechanism?: MechanismStage,
  faultType?: FaultTypeStage,
): AnomalyEvaluation {
  const n = rows.length;
  const preCount = Math.max(12, Math.floor(n * 0.22));
  const monitoredChannels = features.channels.filter(
    (c) => c.group === 'current' || c.group === 'voltage',
  );
  const channels =
    monitoredChannels.length > 0 ? monitoredChannels : features.channels.slice(0, 6);

  const models = channels.map((ch) => ({
    channel: ch.channel,
    group: ch.group,
    fit: fitFundamentalModel(rows, ch.channel, preCount, 60),
  }));

  const omega = 2 * Math.PI * 60;
  const winSize = Math.max(6, Math.min(18, Math.floor(n / 24)));
  const step = Math.max(1, Math.floor(n / 120));

  const timeline: AnomalyTimelinePoint[] = [];
  let maxReconErrPct = 0;
  let highFreqImpulseAccumulator = 0;
  let impulseSamples = 0;

  // Measure sustained DC drift (latter half of post-window so decaying ShortCircuit L/R transients settle)
  // and high-frequency second-difference jitter across post-window
  let maxDcDriftRatio = 0;
  const latePostStart = Math.min(n - 4, Math.floor(n * 0.55));
  for (const m of models) {
    let lateSum = 0;
    let lateCount = 0;
    let secondDiffEnergy = 0;
    let diffCount = 0;
    for (let i = preCount; i < n; i += 1) {
      const y = rows[i][m.channel];
      if (typeof y !== 'number' || !Number.isFinite(y)) continue;
      if (i >= latePostStart) {
        lateSum += y;
        lateCount += 1;
      }

      if (i >= preCount + 1 && i < n - 1) {
        const yPrev = rows[i - 1][m.channel];
        const yNext = rows[i + 1][m.channel];
        if (typeof yPrev === 'number' && typeof yNext === 'number') {
          const d2 = yNext - 2 * y + yPrev;
          secondDiffEnergy += d2 * d2;
          diffCount += 1;
        }
      }
    }

    if (lateCount > 0) {
      const dcDrift = Math.abs(lateSum / lateCount - m.fit.c) / m.fit.baselineRms;
      if (dcDrift > maxDcDriftRatio) maxDcDriftRatio = dcDrift;
    }
    if (diffCount > 0) {
      const jitterRms = Math.sqrt(secondDiffEnergy / diffCount) / m.fit.baselineRms;
      highFreqImpulseAccumulator += jitterRms;
      impulseSamples += 1;
    }
  }

  const avgJitterRatio = impulseSamples > 0 ? highFreqImpulseAccumulator / impulseSamples : 0;
  // Clean 60Hz @ 4kHz has theoretical second-diff ratio ≈ (2*pi*60/4000)^2 ≈ 0.0089;
  // sensor spikes / high-frequency OOD noise push this well above 0.16
  const highFrequencyResidualPct = round1(clamp((avgJitterRatio - 0.06) * 240, 0, 100));
  const dcDriftPct = round1(clamp(maxDcDriftRatio * 100, 0, 100));

  for (let i = 0; i < n; i += step) {
    const start = Math.max(0, i - Math.floor(winSize / 2));
    const end = Math.min(n, start + winSize);
    let maxChErr = 0;

    for (const m of models) {
      let errSq = 0;
      let cnt = 0;
      for (let k = start; k < end; k += 1) {
        const y = rows[k][m.channel];
        if (typeof y !== 'number' || !Number.isFinite(y)) continue;
        const tSec = rows[k].time / 1000;
        const pred =
          m.fit.a * Math.cos(omega * tSec) + m.fit.b * Math.sin(omega * tSec) + m.fit.c;
        const diff = y - pred;
        errSq += diff * diff;
        cnt += 1;
      }
      if (cnt > 0) {
        const errRms = Math.sqrt(errSq / cnt);
        const relErr = errRms / m.fit.baselineRms;
        if (relErr > maxChErr) maxChErr = relErr;
      }
    }

    const errPct = round1(clamp(maxChErr * 100, 0, 200));
    if (errPct > maxReconErrPct) maxReconErrPct = errPct;

    // Map reconstruction error smoothly to a 0-100 anomaly score (nominal noise ~1-5, anomalies >= 25)
    const pointScore = round1(clamp(maxChErr * 110, 0, 100));
    timeline.push({
      time: round1(rows[i].time),
      score: pointScore,
      reconstructionError: round1(Math.min(100, errPct)),
    });
  }

  // Component scores (0-100)
  const reconScore = round1(clamp(maxReconErrPct * 0.95, 0, 100));

  const maxEnvelopeDeviationPct = Math.max(
    features.maxVoltageSagPct,
    features.maxVoltageSwellPct,
    features.maxCurrentDropPct,
    ...features.channels
      .filter((c) => c.group === 'current')
      .map((c) => Math.abs(c.faultRatio - 1) * 100),
    0,
  );
  const envelopeScore = round1(clamp(maxEnvelopeDeviationPct * 1.45, 0, 100));
  const symmetryScore = round1(clamp(features.phaseCurrentImbalancePct * 1.15, 0, 100));
  const oodSignalScore = round1(
    clamp(highFrequencyResidualPct * 0.9 + Math.max(0, dcDriftPct - 24) * 1.15, 0, 100),
  );

  // Peak timeline score gives robust localization of transient bursts even when global RMS barely changes
  const peakTimelineScore =
    timeline.length > 0 ? Math.max(...timeline.map((p) => p.score)) : reconScore;

  const overallScore = round1(
    clamp(
      Math.max(
        reconScore * 0.45 + envelopeScore * 0.35 + symmetryScore * 0.2,
        peakTimelineScore * 0.88,
        oodSignalScore * 0.95,
      ),
      0,
      100,
    ),
  );

  const isAnomalous = overallScore >= ANOMALY_THRESHOLD;

  // Out-of-distribution (OOD) detection:
  // Flag as Unknown / OOD if high-frequency non-sinusoidal sensor/harmonic distortion is severe,
  // or if sustained DC drift occurs outside a ShortCircuit transient,
  // or if anomaly score is high yet the 28-class classifier has low confidence / predicts Healthy.
  const classifierUncertain =
    faultType !== undefined &&
    (faultType.topProbability < 55 || (faultType.topLabel === 'Healthy' && overallScore >= 35));

  const isShortCircuit = mechanism?.topMechanism === 'ShortCircuit';
  const severeNonSinusoidalArtifact =
    highFrequencyResidualPct >= 36 || (!isShortCircuit && dcDriftPct >= 42);
  const isOutOfDistribution =
    isAnomalous &&
    (severeNonSinusoidalArtifact ||
      classifierUncertain ||
      (mechanism !== undefined && mechanism.topProbability < 50));

  const toStatus = (score: number): 'normal' | 'elevated' | 'anomalous' =>
    score >= ANOMALY_THRESHOLD ? 'anomalous' : score >= 14 ? 'elevated' : 'normal';

  const metrics: AnomalyMetric[] = [
    {
      id: 'reconstruction',
      label: '60 Hz Waveform Reconstruction Error',
      score: reconScore,
      valueLabel: `${round1(Math.min(200, maxReconErrPct))}% residual`,
      status: toStatus(reconScore),
    },
    {
      id: 'envelope',
      label: 'RMS Envelope Deviation',
      score: envelopeScore,
      valueLabel: `${round1(maxEnvelopeDeviationPct)}% max shift`,
      status: toStatus(envelopeScore),
    },
    {
      id: 'symmetry',
      label: '3-Phase Symmetry Deviation',
      score: symmetryScore,
      valueLabel: `${features.phaseCurrentImbalancePct.toFixed(1)}% imbalance`,
      status: toStatus(symmetryScore),
    },
    {
      id: 'ood',
      label: 'Harmonic / Sensor OOD Artifact',
      score: oodSignalScore,
      valueLabel: `HF ${highFrequencyResidualPct.toFixed(0)}% · DC ${dcDriftPct.toFixed(0)}%`,
      status: oodSignalScore >= 32 ? 'anomalous' : oodSignalScore >= 16 ? 'elevated' : 'normal',
    },
  ];

  const statusLabel: AnomalyReport['statusLabel'] = !isAnomalous
    ? 'Normal Baseline'
    : isOutOfDistribution
      ? 'Unknown / Out-of-Distribution Anomaly'
      : 'Known Fault Signature';

  const summary = !isAnomalous
    ? 'Signal closely tracks the fitted 60 Hz fundamental baseline with no significant RMS, symmetry, or harmonic anomalies.'
    : isOutOfDistribution
      ? 'Abnormal waveform residual and high-frequency/DC distortion detected that deviate from the 28 canonical fault classes.'
      : 'Anomalous disturbance exceeded the 25.0 reconstruction threshold and aligns cleanly with a canonical fault_type_table.m signature.';

  return {
    report: {
      isAnomalous,
      isOutOfDistribution,
      anomalyScore: overallScore,
      threshold: ANOMALY_THRESHOLD,
      statusLabel,
      summary,
      reconstructionErrorPct: round1(Math.min(200, maxReconErrPct)),
      metrics,
      timeline,
    },
    highFrequencyResidualPct,
    dcDriftPct,
  };
}
