import type { ChannelSummary, ExtractedFeatures, WaveformSample } from '../../shared/types/fault.ts';
import type { ParsedSignalData } from './csvParser.ts';

function computeRms(values: number[]): number {
  if (values.length === 0) return 0;
  let sumSq = 0;
  for (const v of values) {
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / values.length);
}

function classifyChannelMeta(channel: string): {
  label: string;
  unit: string;
  group: 'current' | 'voltage' | 'other';
} {
  const map: Record<string, { label: string; unit: string; group: 'current' | 'voltage' }> = {
    Ia: { label: 'Phase A Current (Ia)', unit: 'A', group: 'current' },
    Ib: { label: 'Phase B Current (Ib)', unit: 'A', group: 'current' },
    Ic: { label: 'Phase C Current (Ic)', unit: 'A', group: 'current' },
    Va: { label: 'Phase A Voltage (Va)', unit: 'kV', group: 'voltage' },
    Vb: { label: 'Phase B Voltage (Vb)', unit: 'kV', group: 'voltage' },
    Vc: { label: 'Phase C Voltage (Vc)', unit: 'kV', group: 'voltage' },
  };
  if (map[channel]) return map[channel];

  const lower = channel.toLowerCase();
  if (lower.startsWith('i') || lower.includes('curr')) {
    return { label: channel, unit: 'A', group: 'current' };
  }
  if (lower.startsWith('v') || lower.includes('volt')) {
    return { label: channel, unit: 'kV', group: 'voltage' };
  }
  return { label: channel, unit: 'pu', group: 'other' };
}

function round(val: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export function extractSignalFeatures(
  parsed: ParsedSignalData,
  fileName: string,
): ExtractedFeatures {
  const { rows, canonicalColumns } = parsed;
  const n = rows.length;

  const durationMs = n > 1 ? Math.max(0.01, rows[n - 1].time - rows[0].time) : 0;
  const samplingRateHz =
    n > 1 && durationMs > 0 ? Math.round(((n - 1) / durationMs) * 1000) : 4000;

  // Use first 22% of samples as pre-fault baseline window and latter 70% as event window
  const preEndIdx = Math.max(4, Math.floor(n * 0.22));
  const postStartIdx = Math.max(preEndIdx, Math.floor(n * 0.3));
  const channels: ChannelSummary[] = [];

  for (const col of canonicalColumns) {
    const vals: number[] = [];
    for (const row of rows) {
      const v = row[col];
      if (typeof v === 'number' && Number.isFinite(v)) {
        vals.push(v);
      }
    }
    if (vals.length === 0) continue;

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of vals) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const mean = sum / vals.length;
    let varSum = 0;
    for (const v of vals) {
      const d = v - mean;
      varSum += d * d;
    }
    const stdDev = Math.sqrt(varSum / vals.length);
    const rms = computeRms(vals);

    const preSlice = vals.slice(0, Math.min(preEndIdx, vals.length));
    const postSlice = vals.slice(Math.min(postStartIdx, vals.length - 1));
    const preFaultRms = Math.max(1e-6, computeRms(preSlice));
    const faultRms = computeRms(postSlice);
    const faultRatio = faultRms / preFaultRms;

    const meta = classifyChannelMeta(col);

    channels.push({
      channel: col,
      label: meta.label,
      unit: meta.unit,
      group: meta.group,
      min: round(min, 3),
      max: round(max, 3),
      mean: round(mean, 4),
      rms: round(rms, 3),
      stdDev: round(stdDev, 3),
      peakToPeak: round(max - min, 3),
      preFaultRms: round(preFaultRms, 3),
      faultRms: round(faultRms, 3),
      faultRatio: round(faultRatio, 3),
    });
  }

  // Zero-sequence residual current I0 = (Ia + Ib + Ic) / 3
  const hasThreePhaseCurrent =
    canonicalColumns.includes('Ia') &&
    canonicalColumns.includes('Ib') &&
    canonicalColumns.includes('Ic');

  let zeroSequenceCurrentRms = 0;
  if (hasThreePhaseCurrent) {
    const i0Series: number[] = rows.map((r: WaveformSample) => {
      const ia = r.Ia ?? 0;
      const ib = r.Ib ?? 0;
      const ic = r.Ic ?? 0;
      return (ia + ib + ic) / 3;
    });
    const postI0 = i0Series.slice(Math.min(postStartIdx, i0Series.length - 1));
    zeroSequenceCurrentRms = round(computeRms(postI0), 3);
  }

  // Current phase imbalance, peak current, and current drop % (for OpenCircuit detection)
  const currentChannels = channels.filter((c) => c.group === 'current');
  let phaseCurrentImbalancePct = 0;
  let peakFaultCurrent = 0;
  let maxCurrentDropPct = 0;
  let dominantPhase = currentChannels[0]?.channel ?? channels[0]?.channel ?? 'N/A';

  if (currentChannels.length > 0) {
    const faultRmsVals = currentChannels.map((c) => c.faultRms);
    const avgRms = faultRmsVals.reduce((a, b) => a + b, 0) / faultRmsVals.length;
    const maxDev = Math.max(...faultRmsVals.map((v) => Math.abs(v - avgRms)));
    phaseCurrentImbalancePct = avgRms > 1e-6 ? round((maxDev / avgRms) * 100, 1) : 0;

    let maxDeviationFromNominal = -1;
    for (const c of currentChannels) {
      const peak = Math.max(Math.abs(c.max), Math.abs(c.min));
      if (peak > peakFaultCurrent) peakFaultCurrent = peak;

      const dropPct = Math.max(0, (1 - c.faultRatio) * 100);
      if (dropPct > maxCurrentDropPct) maxCurrentDropPct = dropPct;

      const deviation = Math.abs(c.faultRatio - 1);
      if (deviation > maxDeviationFromNominal) {
        maxDeviationFromNominal = deviation;
        dominantPhase = c.channel;
      }
    }
    peakFaultCurrent = round(peakFaultCurrent, 2);
    maxCurrentDropPct = round(maxCurrentDropPct, 1);
  } else if (channels.length > 0) {
    peakFaultCurrent = round(
      Math.max(...channels.map((c) => Math.max(Math.abs(c.max), Math.abs(c.min)))),
      2,
    );
  }

  // Maximum voltage sag % (Undervoltage / ShortCircuit) and voltage swell % (Overvoltage)
  const voltageChannels = channels.filter((c) => c.group === 'voltage');
  let maxVoltageSagPct = 0;
  let maxVoltageSwellPct = 0;
  if (voltageChannels.length > 0) {
    const sags = voltageChannels.map((v) =>
      v.preFaultRms > 1e-6 ? Math.max(0, (1 - v.faultRatio) * 100) : 0,
    );
    const swells = voltageChannels.map((v) =>
      v.preFaultRms > 1e-6 ? Math.max(0, (v.faultRatio - 1) * 100) : 0,
    );
    maxVoltageSagPct = round(Math.max(...sags), 1);
    maxVoltageSwellPct = round(Math.max(...swells), 1);
  }

  // Estimate fault inception timestamp using a short sliding-window RMS anomaly detector
  // that detects spikes (ShortCircuit/Overcurrent/Overvoltage) AND drops (Undervoltage/OpenCircuit)
  let faultInceptionMs: number | null = null;
  const monitorChannels = channels.filter((c) => c.group === 'current' || c.group === 'voltage');
  const winSize = Math.max(6, Math.min(24, Math.floor(n / 18)));

  if (monitorChannels.length > 0 && n > winSize * 2) {
    for (let i = Math.floor(n * 0.14); i < n - winSize; i += 1) {
      let triggered = false;
      for (const ch of monitorChannels) {
        let sumSq = 0;
        for (let k = i; k < i + winSize; k += 1) {
          const val = rows[k][ch.channel] ?? 0;
          sumSq += val * val;
        }
        const localRms = Math.sqrt(sumSq / winSize);
        const ratio = localRms / Math.max(1e-6, ch.preFaultRms);
        if (ch.group === 'current' && (ratio > 1.38 || ratio < 0.55)) {
          triggered = true;
          break;
        }
        if (ch.group === 'voltage' && (ratio > 1.15 || ratio < 0.84)) {
          triggered = true;
          break;
        }
      }
      if (triggered) {
        faultInceptionMs = round(rows[i].time, 2);
        break;
      }
    }
  }

  return {
    fileName,
    rowCount: n,
    samplingRateHz,
    durationMs: round(durationMs, 2),
    faultInceptionMs,
    zeroSequenceCurrentRms,
    phaseCurrentImbalancePct,
    maxVoltageSagPct,
    maxVoltageSwellPct,
    maxCurrentDropPct,
    peakFaultCurrent,
    dominantPhase,
    channels,
    availableColumns: canonicalColumns,
  };
}
