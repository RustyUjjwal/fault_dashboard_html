import type { FaultMechanism, FaultTypeLabel, SampleScenario } from '../../shared/types/fault.ts';

interface ScenarioSpec extends SampleScenario {
  affectedPhases: Array<'A' | 'B' | 'C'>;
  grounded: boolean;
  seed: number;
}

const SCENARIO_SPECS: ScenarioSpec[] = [
  {
    id: 'f1_LG_A',
    fileName: 'f1_LG_A.csv',
    title: 'LG_A · ShortCircuit',
    faultLabel: 'LG_A',
    mechanism: 'ShortCircuit',
    description: 'Single-phase Phase A to Ground short circuit with 5.4x current surge, strong I0, and 52% Va voltage sag.',
    affectedPhases: ['A'],
    grounded: true,
    seed: 11,
  },
  {
    id: 'f2_LLG_BC',
    fileName: 'f2_LLG_BC.csv',
    title: 'LLG_BC · ShortCircuit',
    faultLabel: 'LLG_BC',
    mechanism: 'ShortCircuit',
    description: 'Double line-to-ground short circuit across Phases B, C, and Ground with zero-sequence return.',
    affectedPhases: ['B', 'C'],
    grounded: true,
    seed: 23,
  },
  {
    id: 'f3_LL_CA',
    fileName: 'f3_LL_CA.csv',
    title: 'LL_CA · ShortCircuit',
    faultLabel: 'LL_CA',
    mechanism: 'ShortCircuit',
    description: 'Ungrounded line-to-line short circuit between Phases C and A (G=0, negligible I0).',
    affectedPhases: ['C', 'A'],
    grounded: false,
    seed: 37,
  },
  {
    id: 'f4_Overcurrent_ABC',
    fileName: 'f4_Overcurrent_ABC.csv',
    title: 'Overcurrent_ABC · Overload',
    faultLabel: 'Overcurrent_ABC',
    mechanism: 'Overcurrent',
    description: 'Balanced 3-phase overload current (2.3x nominal) while bus voltages remain within normal envelope.',
    affectedPhases: ['A', 'B', 'C'],
    grounded: false,
    seed: 43,
  },
  {
    id: 'f5_Overvoltage_A',
    fileName: 'f5_Overvoltage_A.csv',
    title: 'Overvoltage_A · Swell',
    faultLabel: 'Overvoltage_A',
    mechanism: 'Overvoltage',
    description: 'Phase A voltage swell (+34% above nominal 11.27 kV peak) with near-nominal feeder current.',
    affectedPhases: ['A'],
    grounded: false,
    seed: 59,
  },
  {
    id: 'f6_Undervoltage_B',
    fileName: 'f6_Undervoltage_B.csv',
    title: 'Undervoltage_B · Sag',
    faultLabel: 'Undervoltage_B',
    mechanism: 'Undervoltage',
    description: 'Phase B voltage dip (-36% sag) without a short-circuit fault current spike.',
    affectedPhases: ['B'],
    grounded: false,
    seed: 67,
  },
  {
    id: 'f7_OpenCircuit_C',
    fileName: 'f7_OpenCircuit_C.csv',
    title: 'OpenCircuit_C · Broken Conductor',
    faultLabel: 'OpenCircuit_C',
    mechanism: 'OpenCircuit',
    description: 'Broken conductor on Phase C causing Ic current collapse near 0 A while line voltages persist.',
    affectedPhases: ['C'],
    grounded: false,
    seed: 79,
  },
  {
    id: 'f8_Healthy',
    fileName: 'f8_Healthy.csv',
    title: 'Healthy · Nominal',
    faultLabel: 'Healthy',
    mechanism: 'Healthy',
    description: 'Balanced 60 Hz nominal 3-phase operation across Ia/Ib/Ic and Va/Vb/Vc.',
    affectedPhases: [],
    grounded: false,
    seed: 89,
  },
  {
    id: 'f9_Unknown_Anomaly',
    fileName: 'f9_Unknown_Anomaly.csv',
    title: 'Unknown OOD · Sensor Glitch',
    faultLabel: 'UnknownAnomaly',
    mechanism: 'Unknown',
    description: 'Out-of-distribution CT/PT sensor harmonic burst with DC bias drift that does not belong to the 28 canonical fault classes.',
    affectedPhases: ['A', 'B', 'C'],
    grounded: false,
    seed: 97,
  },
];

function deterministicNoise(index: number, seed: number): number {
  const x = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

export function listSampleScenarios(): SampleScenario[] {
  return SCENARIO_SPECS.map((spec) => ({
    id: spec.id,
    fileName: spec.fileName,
    title: spec.title,
    faultLabel: spec.faultLabel,
    mechanism: spec.mechanism,
    description: spec.description,
  }));
}

export function getSampleScenarioById(id: string): ScenarioSpec | undefined {
  return SCENARIO_SPECS.find((s) => s.id === id);
}

/**
 * Generates realistic 60 Hz 3-phase power-system CSV waveforms for each fault mechanism
 * defined in fault_type_table.m (400 samples @ 4 kHz = 100 ms window, event onset at 28 ms).
 */
export function generateSampleCsv(scenarioId: string): { fileName: string; csv: string } {
  const spec = getSampleScenarioById(scenarioId);
  if (!spec) {
    throw new Error(`Unknown sample scenario: ${scenarioId}`);
  }

  const sampleRateHz = 4000;
  const totalSamples = 400; // 100 ms (6 cycles at 60 Hz)
  const omega = 2 * Math.PI * 60;
  const inceptionSec = 0.028;

  const nominalPeakI = 420; // Amps peak
  const nominalPeakV = 11.27; // kV phase-to-neutral peak

  const lines: string[] = ['time_s,Ia,Ib,Ic,Va,Vb,Vc'];
  const isAffected = (p: 'A' | 'B' | 'C') => spec.affectedPhases.includes(p);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRateHz;
    const postEvent = t >= inceptionSec && spec.mechanism !== 'Healthy';
    const dt = Math.max(0, t - inceptionSec);
    const ramp = postEvent ? 1 - Math.exp(-dt / 0.0014) : 0;
    const dcDecay = postEvent ? Math.exp(-dt / 0.022) : 0;

    const baseAngles = {
      A: omega * t,
      B: omega * t - (2 * Math.PI) / 3,
      C: omega * t + (2 * Math.PI) / 3,
    };

    const computePhase = (phase: 'A' | 'B' | 'C', phaseOffset: number) => {
      const ang = baseAngles[phase];
      const affected = isAffected(phase);
      const noiseI = deterministicNoise(i + phaseOffset * 13, spec.seed) * 4.0;
      const noiseV = deterministicNoise(i + phaseOffset * 29, spec.seed) * 0.07;

      let current = nominalPeakI * Math.sin(ang);
      let voltage = nominalPeakV * Math.sin(ang);

      if (postEvent && affected) {
        switch (spec.mechanism) {
          case 'ShortCircuit': {
            const mult = spec.affectedPhases.length === 1 ? 5.4 : 4.7;
            const sagFactor = spec.affectedPhases.length === 1 ? 0.46 : 0.52;
            const faultSin = Math.sin(ang - 1.12);
            const dcComp = spec.grounded
              ? nominalPeakI * (mult * 0.4) * dcDecay
              : nominalPeakI * (mult * 0.16) * dcDecay * (phase === 'A' ? 1 : -1);
            current = current + ramp * (nominalPeakI * (mult - 1) * faultSin + dcComp);
            const ring = 0.4 * Math.exp(-dt / 0.004) * Math.sin(2 * Math.PI * 620 * dt);
            voltage = voltage * (1 - ramp * (1 - sagFactor)) + ring;
            break;
          }
          case 'Overcurrent': {
            // 2.35x sustained overload current with minor 4% voltage drop (no short-circuit collapse)
            const overloadCurrent = nominalPeakI * 2.35 * Math.sin(ang - 0.18);
            current = current + ramp * (overloadCurrent - current);
            voltage = voltage * (1 - ramp * 0.04);
            break;
          }
          case 'Overvoltage': {
            // +34% voltage swell with minor resistive current rise (+12%)
            voltage = voltage * (1 + ramp * 0.34);
            current = current * (1 + ramp * 0.12);
            break;
          }
          case 'Undervoltage': {
            // -36% voltage sag with slightly lower current (-10%) — clearly distinct from ShortCircuit
            voltage = voltage * (1 - ramp * 0.36);
            current = current * (1 - ramp * 0.1);
            break;
          }
          case 'OpenCircuit': {
            // Broken conductor: phase current collapses to ~3% leakage while voltage stays intact (+3%)
            current = current * (1 - ramp * 0.97);
            voltage = voltage * (1 + ramp * 0.03);
            break;
          }
          case 'Unknown': {
            // Out-of-distribution sensor glitch: non-sinusoidal high-frequency bursts, erratic impulse spikes, and DC offset drift
            const burst =
              Math.sin(2 * Math.PI * 870 * dt + phaseOffset) * 145 +
              Math.sin(2 * Math.PI * 1420 * dt) * 110;
            const impulse = i % 9 === phaseOffset ? (phaseOffset % 2 === 0 ? 290 : -260) : 0;
            const dcShift = phase === 'A' ? 210 : phase === 'B' ? -140 : 95;
            current = current + ramp * (burst + impulse + dcShift);
            voltage =
              voltage +
              ramp *
                (Math.sin(2 * Math.PI * 980 * dt + phaseOffset) * 2.4 +
                  (i % 11 === phaseOffset ? 3.2 : 0));
            break;
          }
          default:
            break;
        }
      } else if (postEvent && !affected && spec.mechanism === 'ShortCircuit' && spec.grounded) {
        // Subtle neutral shift swell on healthy phases during grounded short circuit
        voltage = voltage * (1 + ramp * 0.08);
      }

      return {
        iVal: current + noiseI,
        vVal: voltage + noiseV,
      };
    };

    const phA = computePhase('A', 1);
    const phB = computePhase('B', 2);
    const phC = computePhase('C', 3);

    let ia = phA.iVal;
    let ib = phB.iVal;
    let ic = phC.iVal;

    // For ungrounded 2-phase short circuits (LL_AB, LL_BC, LL_CA), enforce Ia + Ib + Ic ≈ 0
    if (
      postEvent &&
      spec.mechanism === 'ShortCircuit' &&
      !spec.grounded &&
      spec.affectedPhases.length === 2
    ) {
      const residual = (ia + ib + ic) / 3;
      ia -= residual;
      ib -= residual;
      ic -= residual;
    }

    lines.push(
      [
        t.toFixed(6),
        ia.toFixed(3),
        ib.toFixed(3),
        ic.toFixed(3),
        phA.vVal.toFixed(4),
        phB.vVal.toFixed(4),
        phC.vVal.toFixed(4),
      ].join(','),
    );
  }

  return {
    fileName: spec.fileName,
    csv: lines.join('\n'),
  };
}
