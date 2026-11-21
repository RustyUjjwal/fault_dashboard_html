/**
 * Fault Analyzer Dashboard — Pure Vanilla JavaScript Application Controller
 * Includes toggleable modules for:
 *  1. Live Anomaly Threshold Calibration
 *  2. Symmetrical Components (I1/I2/I0, V1/V2/V0) & 3-Phase Phasor Diagram
 *  3. FFT Harmonic Spectrum & THD
 *  4. Model Explainability (Temporal Saliency Overlay + Feature Attributions)
 *  5. Batch CSV Evaluation & Interactive Confusion Matrix
 *  6. Printable PDF Diagnostic Report Export
 */

import {
  getSeriesColor,
  renderAnomalyAreaChart,
  renderHorizontalProbChart,
  renderPhasorDiagram,
  renderRmsBarChart,
  renderSpectrumChart,
  renderWaveformChart,
} from './charts.js';

const FASTAPI_SNIPPET = `# FastAPI ML Inference Adapter matching fault_type_table.m (28 classes)
# Run locally on port 8000, then set ML_SERVICE_URL=http://localhost:8000/predict
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class PredictRequest(BaseModel):
    fileName: str
    features: dict
    waveform: list[dict]

@app.post("/predict")
def predict(req: PredictRequest):
    # Return your single 28-class softmax dictionary + optional anomalyScore.
    # The backend automatically rolls this up into Step 1 (Fault & OOD Anomaly Detection),
    # Step 2 (ShortCircuit vs Overcurrent/Overvoltage/Undervoltage/OpenCircuit/Healthy),
    # and Step 3 (Exact 28-class label + {G, A, B, C} flags).
    return {
        "classProbabilities": {
            "LG_A": 0.912,
            "LLG_CA": 0.041,
            "LL_CA": 0.022,
            "Overcurrent_A": 0.015,
            "Healthy": 0.010,
        },
        "anomalyScore": 88.4,
    }`;

const JAVA_RUN_SNIPPET = `# Run the included zero-dependency Java 11+ backend locally:
cd java-backend
javac FaultAnalyzerServer.java
java FaultAnalyzerServer

# Optional: connect an external Python/ONNX ML service
ML_SERVICE_URL=http://localhost:8000/predict java FaultAnalyzerServer`;

const MODULE_DEFINITIONS = [
  { key: 'threshold', label: 'Anomaly Threshold' },
  { key: 'phasors', label: 'Phasors & Seq' },
  { key: 'fft', label: 'FFT & THD' },
  { key: 'explainability', label: 'Explainability' },
  { key: 'batch', label: 'Batch Eval' },
  { key: 'pdf', label: 'PDF Report' },
];

const state = {
  activeTab: 'overview',
  samples: [],
  providers: [],
  taxonomy: [],
  selectedProviderId: 'physics-baseline',
  activeSampleId: 'f1_LG_A',
  analysis: null,
  history: [],
  isLoading: false,
  errorMessage: null,

  // Toggleable diagnostic modules (all wired with live switches)
  modules: {
    threshold: true,
    phasors: true,
    fft: true,
    explainability: true,
    batch: false,
    pdf: true,
  },

  // Live Anomaly Threshold override
  anomalyThreshold: 25,

  // Interactive UI controls
  showAnomalyDetails: false,
  showAllMechanisms: false,
  showAllTypes: false,
  waveGroup: 'current',
  phasorGroup: 'current',
  fftGroup: 'current',
  hiddenChannels: {},
  zoomStartPct: 0,
  zoomEndPct: 100,
  analyticsTab: 'anomaly',
  statsGroupFilter: 'all',
  statsSortKey: 'channel',
  statsSortAsc: true,
  taxonomyFilter: 'All',

  // Batch evaluation state
  batchResult: null,
  batchLoading: false,

  // Enlarged focused oscillogram modal state
  oscModalOpen: false,
  modalWaveGroup: 'current',
  modalSourceAnalysis: null,

  // Split-Screen comparison state (Waveforms view)
  wfMode: 'single',
  compareAnalysis: null,
  compareSampleId: null,
  compareGroup: 'current',
  compareLockY: true,
  compareLoading: false,
};

const els = {
  fileInput: document.getElementById('csv-file-input'),
  batchFileInput: document.getElementById('batch-csv-input'),
  compareFileInput: document.getElementById('compare-csv-input'),
  brandHome: document.getElementById('brand-home'),
  topbarUploadBtn: document.getElementById('topbar-upload-btn'),
  browseFileBtn: document.getElementById('browse-file-btn'),
  printPdfBtn: document.getElementById('print-pdf-btn'),
  downloadSampleBtn: document.getElementById('download-sample-btn'),
  dropZone: document.getElementById('drop-zone'),
  loadedFileName: document.getElementById('loaded-file-name'),
  loadedFileMeta: document.getElementById('loaded-file-meta'),
  sampleBar: document.getElementById('sample-bar'),
  moduleToggleBar: document.getElementById('module-toggle-bar'),
  inferenceMeta: document.getElementById('inference-meta'),
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  errorDismissBtn: document.getElementById('error-dismiss-btn'),
  loadingSkeleton: document.getElementById('loading-skeleton'),
  kpiStrip: document.getElementById('kpi-strip'),
  triageColumn: document.getElementById('triage-column'),

  // Overview waveform controls
  ovWaveTitle: document.getElementById('ov-wave-title'),
  ovWaveSubtitle: document.getElementById('ov-wave-subtitle'),
  ovWaveGroupToggle: document.getElementById('ov-wave-group-toggle'),
  ovExpandWaveBtn: document.getElementById('ov-expand-wave-btn'),
  ovChannelToggles: document.getElementById('ov-channel-toggles'),
  ovTriggerLabel: document.getElementById('ov-trigger-label'),
  ovWaveformCanvas: document.getElementById('ov-waveform-canvas'),
  ovWaveformTooltip: document.getElementById('ov-waveform-tooltip'),
  ovZoomStart: document.getElementById('ov-zoom-start'),
  ovZoomEnd: document.getElementById('ov-zoom-end'),
  ovZoomReset: document.getElementById('ov-zoom-reset'),

  // Overview analytics controls + Threshold Calibrator
  ovAnalyticsTitle: document.getElementById('ov-analytics-title'),
  ovAnalyticsSubtitle: document.getElementById('ov-analytics-subtitle'),
  ovAnalyticsTabs: document.getElementById('ov-analytics-tabs'),
  thresholdCalibrator: document.getElementById('threshold-calibrator'),
  thresholdLiveReadout: document.getElementById('threshold-live-readout'),
  thresholdSlider: document.getElementById('anomaly-threshold-slider'),
  thresholdReset: document.getElementById('anomaly-threshold-reset'),
  ovAnalyticsCanvas: document.getElementById('ov-analytics-canvas'),
  ovAnalyticsTooltip: document.getElementById('ov-analytics-tooltip'),
  ovAnomalyMetricsStrip: document.getElementById('ov-anomaly-metrics-strip'),

  // Advanced toggleable panels
  advancedDiagnosticsGrid: document.getElementById('advanced-diagnostics-grid'),
  modulePhasorsPanel: document.getElementById('module-phasors-panel'),
  phasorGroupToggle: document.getElementById('phasor-group-toggle'),
  phasorSubtitle: document.getElementById('phasor-subtitle'),
  phasorCanvas: document.getElementById('phasor-canvas'),
  sequenceReadout: document.getElementById('sequence-readout'),

  moduleFftPanel: document.getElementById('module-fft-panel'),
  fftGroupToggle: document.getElementById('fft-group-toggle'),
  fftTitle: document.getElementById('fft-title'),
  fftSubtitle: document.getElementById('fft-subtitle'),
  fftCanvas: document.getElementById('fft-canvas'),
  fftTooltip: document.getElementById('fft-tooltip'),

  moduleExplainabilityPanel: document.getElementById('module-explainability-panel'),
  moduleBatchPanel: document.getElementById('module-batch-panel'),

  overviewStatsContainer: document.getElementById('overview-stats-container'),

  // Waveforms view (Single + Split-Screen Compare)
  wfModeToggle: document.getElementById('wf-mode-toggle'),
  wfSingleWorkspace: document.getElementById('wf-single-workspace'),
  wfCompareWorkspace: document.getElementById('wf-compare-workspace'),
  wfDualGrid: document.getElementById('wf-dual-grid'),
  wfCurrentSubtitle: document.getElementById('wf-current-subtitle'),
  wfCurrentToggles: document.getElementById('wf-current-toggles'),
  wfExpandCurrentBtn: document.getElementById('wf-expand-current-btn'),
  wfCurrentCanvas: document.getElementById('wf-current-canvas'),
  wfCurrentTooltip: document.getElementById('wf-current-tooltip'),
  wfVoltagePanel: document.getElementById('wf-voltage-panel'),
  wfVoltageSubtitle: document.getElementById('wf-voltage-subtitle'),
  wfVoltageToggles: document.getElementById('wf-voltage-toggles'),
  wfExpandVoltageBtn: document.getElementById('wf-expand-voltage-btn'),
  wfVoltageCanvas: document.getElementById('wf-voltage-canvas'),
  wfVoltageTooltip: document.getElementById('wf-voltage-tooltip'),
  wfAnomalySubtitle: document.getElementById('wf-anomaly-subtitle'),
  wfAnomalyCanvas: document.getElementById('wf-anomaly-canvas'),
  wfAnomalyTooltip: document.getElementById('wf-anomaly-tooltip'),
  wfAnomalyMetricsStrip: document.getElementById('wf-anomaly-metrics-strip'),

  // Split-Screen Compare controls & canvases
  cmpSelectA: document.getElementById('cmp-select-a'),
  cmpSelectB: document.getElementById('cmp-select-b'),
  cmpUploadABtn: document.getElementById('cmp-upload-a-btn'),
  cmpUploadBBtn: document.getElementById('cmp-upload-b-btn'),
  cmpSwapBtn: document.getElementById('cmp-swap-btn'),
  cmpWaveGroupToggle: document.getElementById('cmp-wave-group-toggle'),
  cmpLockYBtn: document.getElementById('cmp-lock-y-btn'),
  cmpZoomStart: document.getElementById('cmp-zoom-start'),
  cmpZoomEnd: document.getElementById('cmp-zoom-end'),
  cmpZoomReset: document.getElementById('cmp-zoom-reset'),

  cmpATitle: document.getElementById('cmp-a-title'),
  cmpASubtitle: document.getElementById('cmp-a-subtitle'),
  cmpAFocusBtn: document.getElementById('cmp-a-focus-btn'),
  cmpASummary: document.getElementById('cmp-a-summary'),
  cmpAToggles: document.getElementById('cmp-a-toggles'),
  cmpATrigger: document.getElementById('cmp-a-trigger'),
  cmpAWaveCanvas: document.getElementById('cmp-a-wave-canvas'),
  cmpAWaveTooltip: document.getElementById('cmp-a-wave-tooltip'),
  cmpAAnomVal: document.getElementById('cmp-a-anom-val'),
  cmpAAnomCanvas: document.getElementById('cmp-a-anom-canvas'),
  cmpAAnomTooltip: document.getElementById('cmp-a-anom-tooltip'),

  cmpBTitle: document.getElementById('cmp-b-title'),
  cmpBSubtitle: document.getElementById('cmp-b-subtitle'),
  cmpBFocusBtn: document.getElementById('cmp-b-focus-btn'),
  cmpBSummary: document.getElementById('cmp-b-summary'),
  cmpBToggles: document.getElementById('cmp-b-toggles'),
  cmpBTrigger: document.getElementById('cmp-b-trigger'),
  cmpBWaveCanvas: document.getElementById('cmp-b-wave-canvas'),
  cmpBWaveTooltip: document.getElementById('cmp-b-wave-tooltip'),
  cmpBAnomVal: document.getElementById('cmp-b-anom-val'),
  cmpBAnomCanvas: document.getElementById('cmp-b-anom-canvas'),
  cmpBAnomTooltip: document.getElementById('cmp-b-anom-tooltip'),
  cmpDeltaPanel: document.getElementById('cmp-delta-panel'),

  // Enlarged Focused Oscillogram Modal
  oscModal: document.getElementById('oscillogram-modal'),
  modalWaveTitle: document.getElementById('modal-wave-title'),
  modalWaveSubtitle: document.getElementById('modal-wave-subtitle'),
  modalWaveGroupToggle: document.getElementById('modal-wave-group-toggle'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalChannelToggles: document.getElementById('modal-channel-toggles'),
  modalTriggerLabel: document.getElementById('modal-trigger-label'),
  modalZoomBadge: document.getElementById('modal-zoom-badge'),
  modalZoomIn: document.getElementById('modal-zoom-in'),
  modalZoomOut: document.getElementById('modal-zoom-out'),
  modalPanLeft: document.getElementById('modal-pan-left'),
  modalPanRight: document.getElementById('modal-pan-right'),
  modalFocusOnset: document.getElementById('modal-focus-onset'),
  modalZoomReset: document.getElementById('modal-zoom-reset'),
  modalWaveformCanvas: document.getElementById('modal-waveform-canvas'),
  modalWaveformTooltip: document.getElementById('modal-waveform-tooltip'),
  modalZoomStart: document.getElementById('modal-zoom-start'),
  modalZoomEnd: document.getElementById('modal-zoom-end'),
  modalWindowStats: document.getElementById('modal-window-stats'),

  // Statistics view
  stRmsTitle: document.getElementById('st-rms-title'),
  stRmsCanvas: document.getElementById('st-rms-canvas'),
  stRmsTooltip: document.getElementById('st-rms-tooltip'),
  statisticsTableContainer: document.getElementById('statistics-table-container'),

  // Views
  viewOverview: document.getElementById('view-overview'),
  viewWaveforms: document.getElementById('view-waveforms'),
  viewStatistics: document.getElementById('view-statistics'),
  viewBackend: document.getElementById('view-backend'),
  footerBackendBtn: document.getElementById('footer-backend-btn'),
};

function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  }
  return data;
}

/**
 * Computes effective anomaly/detection state using the user's live calibrated Anomaly Threshold.
 */
function getEffectiveAnomalyState(analysis) {
  const threshold = state.anomalyThreshold;
  const score = analysis.anomaly.anomalyScore;
  const isAnomalous = score >= threshold;
  const isOod = isAnomalous && analysis.anomaly.isOutOfDistribution;

  const statusLabel = !isAnomalous
    ? 'Normal Baseline'
    : isOod
      ? 'Unknown / Out-of-Distribution Anomaly'
      : 'Known Fault Signature';

  let detectionLabel = analysis.detection.statusLabel;
  let faultDetected = analysis.detection.faultDetected;

  if (!isAnomalous && analysis.faultType.topLabel === 'Healthy') {
    detectionLabel = 'HEALTHY';
    faultDetected = false;
  } else if (isOod) {
    detectionLabel = 'UNKNOWN ANOMALY';
    faultDetected = true;
  } else if (isAnomalous && !faultDetected) {
    detectionLabel = 'UNKNOWN ANOMALY';
    faultDetected = true;
  } else if (!isAnomalous && detectionLabel === 'UNKNOWN ANOMALY') {
    detectionLabel = analysis.faultType.topLabel === 'Healthy' ? 'HEALTHY' : 'FAULT DETECTED';
    faultDetected = analysis.faultType.topLabel !== 'Healthy';
  }

  return {
    threshold,
    score,
    isAnomalous,
    isOod,
    statusLabel,
    detectionLabel,
    faultDetected,
  };
}

function setError(message) {
  state.errorMessage = message;
  if (message) {
    els.errorText.textContent = message;
    els.errorBanner.classList.remove('hidden');
  } else {
    els.errorBanner.classList.add('hidden');
  }
}

function setLoading(flag) {
  state.isLoading = flag;
  els.browseFileBtn.disabled = flag;
  if (!state.analysis && flag) {
    els.loadingSkeleton.classList.remove('hidden');
  } else {
    els.loadingSkeleton.classList.add('hidden');
  }
  renderSampleBar();
}

function pushAnalysis(result) {
  state.analysis = result;
  state.zoomStartPct = 0;
  state.zoomEndPct = 100;
  if (els.ovZoomStart) els.ovZoomStart.value = '0';
  if (els.ovZoomEnd) els.ovZoomEnd.value = '100';
  if (els.cmpZoomStart) els.cmpZoomStart.value = '0';
  if (els.cmpZoomEnd) els.cmpZoomEnd.value = '100';
  state.history = [result, ...state.history.filter((h) => h.id !== result.id)].slice(0, 12);
  renderAll();
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderViewsVisibility();
  if (tab === 'waveforms' && state.wfMode === 'compare') {
    ensureCompareSignalLoaded();
  }
  requestAnimationFrame(() => renderActiveCharts());
}

function renderViewsVisibility() {
  const hasAnalysis = Boolean(state.analysis);
  const isBackend = state.activeTab === 'backend';

  els.kpiStrip.classList.toggle('hidden', !hasAnalysis || isBackend);
  els.viewOverview.classList.toggle('hidden', !hasAnalysis || state.activeTab !== 'overview');
  els.viewWaveforms.classList.toggle('hidden', !hasAnalysis || state.activeTab !== 'waveforms');
  els.viewStatistics.classList.toggle('hidden', !hasAnalysis || state.activeTab !== 'statistics');
  els.viewBackend.classList.toggle('hidden', !isBackend);
}

function renderModuleToggleBar() {
  const buttonsHtml = MODULE_DEFINITIONS.map((mod) => {
    const isOn = Boolean(state.modules[mod.key]);
    return `
      <button
        type="button"
        class="mod-toggle ${isOn ? 'on' : ''}"
        data-mod-toggle="${mod.key}"
        aria-pressed="${isOn}"
        title="Toggle ${esc(mod.label)}"
      >
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        <span>${esc(mod.label)}</span>
      </button>`;
  }).join('');

  els.moduleToggleBar.innerHTML = `
    <span class="module-bar-label">Diagnostic Modules</span>
    <div class="module-toggle-grid">${buttonsHtml}</div>
    <div class="module-bulk-actions">
      <button type="button" class="btn-ghost" data-mod-bulk="all">Enable All</button>
      <button type="button" class="btn-ghost" data-mod-bulk="none">Core Only</button>
    </div>
  `;

  els.printPdfBtn.classList.toggle('hidden', !state.modules.pdf || !state.analysis);
}

function renderHeaderMeta() {
  if (!state.analysis) {
    els.inferenceMeta.innerHTML = '';
    return;
  }
  const inf = state.analysis.inference;
  els.inferenceMeta.innerHTML = `
    <span>Provider: ${esc(inf.providerName)}</span>
    <span aria-hidden="true">&middot;</span>
    <span>Inference ${inf.inferenceTimeMs.toFixed(1)} ms</span>
  `;
}

function renderUploadBar() {
  const a = state.analysis;
  if (a) {
    els.loadedFileName.textContent = a.fileName;
    els.loadedFileMeta.textContent = `${formatBytes(a.fileSizeBytes)} · ${a.features.rowCount.toLocaleString()} samples · Drag and drop any 3-phase CSV here`;
  } else {
    els.loadedFileName.textContent = state.isLoading ? 'Loading signal...' : 'No CSV signal loaded';
    els.loadedFileMeta.textContent =
      'Drag and drop a CSV file (time, Ia, Ib, Ic, Va, Vb, Vc) or click Browse File';
  }

  const activeSample = state.samples.find((s) => s.id === state.activeSampleId);
  if (activeSample) {
    els.downloadSampleBtn.href = `/api/samples/${encodeURIComponent(activeSample.id)}/csv`;
    els.downloadSampleBtn.download = activeSample.fileName;
    els.downloadSampleBtn.classList.remove('hidden');
  } else {
    els.downloadSampleBtn.classList.add('hidden');
  }

  els.printPdfBtn.classList.toggle('hidden', !state.modules.pdf || !a);
}

function renderSampleBar() {
  if (!state.samples.length) {
    els.sampleBar.innerHTML = '';
    return;
  }

  const buttons = state.samples
    .map(
      (sample) => `
      <button
        type="button"
        class="sample-btn ${sample.id === state.activeSampleId ? 'active' : ''}"
        data-sample-id="${esc(sample.id)}"
        title="${esc(sample.fileName)}"
        ${state.isLoading ? 'disabled' : ''}
      >
        ${esc(sample.fileName)}
      </button>`,
    )
    .join('');

  els.sampleBar.innerHTML = `
    <span class="sample-bar-label">Sample Signals</span>
    <div class="sample-grid">${buttons}</div>
  `;
}

function renderKpiStrip() {
  const a = state.analysis;
  if (!a) return;

  const f = a.features;
  const eff = getEffectiveAnomalyState(a);
  const swellHigher = f.maxVoltageSwellPct > f.maxVoltageSagPct;
  const anomalyTone = eff.isOod ? 'tone-orange' : eff.isAnomalous ? 'tone-red' : 'tone-emerald';

  els.kpiStrip.innerHTML = `
    <div class="kpi-cell">
      <div class="kpi-label">Peak Phase Current</div>
      <div class="kpi-value-row">
        <span class="kpi-value">${f.peakFaultCurrent.toLocaleString()}</span>
        <span class="kpi-unit">A</span>
      </div>
      <div class="kpi-sub mono">Dominant: ${esc(f.dominantPhase)} &middot; Drop ${f.maxCurrentDropPct.toFixed(1)}%</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-label">${swellHigher ? 'Max Voltage Swell' : 'Max Voltage Sag'}</div>
      <div class="kpi-value-row">
        <span class="kpi-value">${swellHigher ? '+' + f.maxVoltageSwellPct.toFixed(1) : '-' + f.maxVoltageSagPct.toFixed(1)}</span>
        <span class="kpi-unit">%</span>
      </div>
      <div class="kpi-sub mono tabular-nums">Sag ${f.maxVoltageSagPct.toFixed(1)}% &middot; Swell ${f.maxVoltageSwellPct.toFixed(1)}%</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-label">Zero-Sequence Current (I0)</div>
      <div class="kpi-value-row">
        <span class="kpi-value">${f.zeroSequenceCurrentRms.toFixed(1)}</span>
        <span class="kpi-unit">A RMS</span>
      </div>
      <div class="kpi-sub">${a.faultType.flags.G === 1 ? 'Ground path active (G=1)' : 'No ground fault path (G=0)'}</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-label">Anomaly Score (Thr ${eff.threshold.toFixed(0)})</div>
      <div class="kpi-value-row">
        <span class="kpi-value ${anomalyTone}">${eff.score.toFixed(1)}</span>
        <span class="kpi-unit">/ 100</span>
      </div>
      <div class="kpi-sub">${esc(eff.statusLabel)}</div>
    </div>
  `;
}

function renderTriagePipeline() {
  const a = state.analysis;
  if (!a) return;

  const { detection, anomaly, mechanism, faultType, features } = a;
  const eff = getEffectiveAnomalyState(a);
  const isFault = eff.faultDetected;
  const isOod = eff.isOod;

  const step1CardClass = isOod ? 'step-ood' : isFault ? 'step-fault' : 'step-healthy';
  const step1Tone = isOod ? 'tone-orange' : isFault ? 'tone-red' : 'tone-emerald';
  const step1ConfTone = isOod
    ? 'tone-orange-soft'
    : isFault
      ? 'tone-red-soft'
      : 'tone-emerald-soft';
  const fillClass = isOod ? 'fill-orange' : eff.isAnomalous ? 'fill-red' : 'fill-emerald';

  const visibleMechanisms = state.showAllMechanisms
    ? mechanism.probabilities
    : mechanism.probabilities.slice(0, 3);

  const visibleTypes = state.showAllTypes
    ? faultType.probabilities
    : faultType.probabilities.slice(0, 3);

  const anomalyDetailsHtml = state.showAnomalyDetails
    ? `<div class="anomaly-breakdown">
        ${anomaly.metrics
          .map((m) => {
            const tone =
              m.score >= eff.threshold
                ? 'tone-red'
                : m.score >= eff.threshold * 0.6
                  ? 'tone-amber'
                  : 'tone-emerald';
            return `<div class="anomaly-row">
              <div>
                <span style="color:#E2E8F0;">${esc(m.label)}</span>
                <span class="mono" style="color:#64748B;margin-left:6px;">(${esc(m.valueLabel)})</span>
              </div>
              <span class="mono tabular-nums ${tone}" style="font-weight:700;">${m.score.toFixed(1)}</span>
            </div>`;
          })
          .join('')}
      </div>`
    : '';

  const flagsList = [
    { key: 'G', name: 'Ground', active: faultType.flags.G },
    { key: 'A', name: 'Phase A', active: faultType.flags.A },
    { key: 'B', name: 'Phase B', active: faultType.flags.B },
    { key: 'C', name: 'Phase C', active: faultType.flags.C },
  ];

  const mechDisplayTitle =
    {
      ShortCircuit: 'SHORT CIRCUIT',
      Overcurrent: 'OVERCURRENT',
      Overvoltage: 'OVERVOLTAGE',
      Undervoltage: 'UNDERVOLTAGE',
      OpenCircuit: 'OPEN CIRCUIT',
      Healthy: 'HEALTHY',
    }[mechanism.topMechanism] || mechanism.topMechanismTitle;

  const mechCategoryText = mechanism.isShortCircuit
    ? 'Short-Circuit Contact'
    : mechanism.topMechanism === 'Healthy'
      ? 'Nominal Operation'
      : 'Non-Short-Circuit (Per-Phase)';

  const formatMechanismRowLabel = (item) => {
    const shortLabels = {
      ShortCircuit: 'ShortCircuit (Phase / Ground)',
      Overcurrent: 'Overcurrent (Phase Overload)',
      Overvoltage: 'Overvoltage (Phase Swell)',
      Undervoltage: 'Undervoltage (Phase Sag)',
      OpenCircuit: 'OpenCircuit (Open Phase)',
      Healthy: 'Healthy (Balanced Nominal)',
    };
    return shortLabels[item.code] || item.label;
  };

  els.triageColumn.innerHTML = `
    <section class="step-card ${step1CardClass}" aria-label="Step 1 Fault and Anomaly Detection">
      <div class="step-head">
        <div class="step-top">
          <span class="step-kicker ${step1Tone}">Step 1 &mdash; Fault &amp; Anomaly Detection</span>
          <span class="step-meta-right mono tabular-nums">
            ${features.faultInceptionMs !== null ? `Onset ${features.faultInceptionMs.toFixed(2)} ms` : 'No disturbance trigger'}
          </span>
        </div>

        <div class="step-headline-row">
          <h2 class="step-headline ${step1Tone}">${esc(eff.detectionLabel)}</h2>
          <span class="step-confidence ${step1ConfTone}">Confidence: ${detection.confidence.toFixed(1)}%</span>
        </div>
      </div>

      <div class="anomaly-gauge-block">
        <div class="anomaly-gauge-header">
          <span>
            Anomaly Score
            <span style="color:#64748B;">(${esc(eff.statusLabel)})</span>
          </span>
          <span class="mono tabular-nums" style="font-weight:600;">
            ${eff.score.toFixed(1)}
            <span style="color:#64748B;font-weight:400;">/ 100 (thr ${eff.threshold.toFixed(0)})</span>
          </span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${fillClass}" style="transform:scaleX(${Math.max(0.015, Math.min(1, eff.score / 100))});"></div>
          <div class="threshold-tick" style="left:${eff.threshold}%;" title="Threshold ${eff.threshold}"></div>
        </div>
      </div>

      ${
        isOod
          ? `<div class="ood-alert-box">
              Out-of-distribution disturbance detected: waveform residual and harmonic/DC distortion deviate from the 28 canonical classes. Treat downstream class predictions as fallback estimates.
            </div>`
          : ''
      }

      <div>
        <div class="step-footer">
          <div class="inline-meta" style="margin-top:0;">
            <span>Severity: <strong style="text-transform:capitalize;">${esc(detection.severity)}</strong></span>
            <span aria-hidden="true">&middot;</span>
            <span class="mono tabular-nums">Recon Error ${anomaly.reconstructionErrorPct.toFixed(1)}%</span>
          </div>
          <button type="button" class="link-btn no-print" data-action="toggle-anomaly-details">
            ${state.showAnomalyDetails ? 'Hide metrics' : 'Anomaly metrics'}
          </button>
        </div>
        ${anomalyDetailsHtml}
      </div>
    </section>

    <section class="step-card step-mechanism" aria-label="Step 2 Short-Circuit and Mechanism Triage">
      <div class="step-head">
        <div class="step-top">
          <span class="step-kicker tone-amber">Step 2 &mdash; Short-Circuit / Mechanism Triage</span>
          <button type="button" class="link-btn no-print" data-action="toggle-mechanisms">
            ${state.showAllMechanisms ? 'Show top 3' : `All ${mechanism.probabilities.length} mechanisms`}
          </button>
        </div>

        <div class="step-headline-row">
          <h2 class="step-headline tone-amber">${esc(mechDisplayTitle)}</h2>
          <span class="step-confidence tone-amber-soft">Confidence: ${mechanism.topProbability.toFixed(1)}%</span>
        </div>
      </div>

      <div class="mech-meta-grid">
        <div class="mech-meta-cell">
          <span class="mech-meta-label">Event Category</span>
          <strong class="mech-meta-value">${esc(mechCategoryText)}</strong>
        </div>
        <div class="mech-meta-cell mech-meta-right">
          <span class="mech-meta-label">P(ShortCircuit)</span>
          <strong class="mech-meta-value mono tabular-nums ${mechanism.isShortCircuit ? 'tone-amber' : ''}">${mechanism.shortCircuitProbability.toFixed(1)}%</strong>
        </div>
      </div>

      <div class="prob-list">
        ${visibleMechanisms
          .map(
            (item, idx) => `
          <div class="prob-row">
            <div class="prob-label" title="${esc(item.label)}">
              <span class="prob-rank">${idx + 1}.</span>${esc(formatMechanismRowLabel(item))}
            </div>
            <div class="prob-value">${item.probability.toFixed(1)}%</div>
            <div class="progress-track">
              <div class="progress-fill fill-amber" style="transform:scaleX(${Math.max(0.015, Math.min(1, item.probability / 100))});"></div>
            </div>
          </div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="step-card step-type" aria-label="Step 3 Fault Type Classification">
      <div class="step-head">
        <div class="step-top">
          <span class="step-kicker tone-purple">
            ${
              mechanism.isShortCircuit
                ? 'Step 3 &mdash; Short-Circuit Subtype Classification'
                : 'Step 3 &mdash; Specific Fault Type Classification'
            }
          </span>
          <button type="button" class="link-btn no-print" data-action="toggle-types">
            ${state.showAllTypes ? 'Show top 3' : `Top ${faultType.probabilities.length} classes`}
          </button>
        </div>

        <div class="step-headline-row">
          <h2 class="step-headline tone-purple">${esc(faultType.topTitle)}</h2>
          <span class="step-confidence tone-purple-soft">Top Type: ${faultType.topProbability.toFixed(1)}%</span>
        </div>
      </div>

      <div>
        <div class="flag-grid" style="margin-top:0;">
          ${flagsList
            .map(
              (fl) => `
            <div class="flag-cell ${fl.active === 1 ? 'active' : ''}">
              <span>${fl.name}</span>
              <span class="flag-val">${fl.key}=${fl.active}</span>
            </div>`,
            )
            .join('')}
        </div>

        <div class="inline-meta">
          <span>Structure: <strong>${esc(faultType.symmetry)}</strong></span>
          <span aria-hidden="true">&middot;</span>
          <span>Mechanism: <strong class="mono">${esc(faultType.mechanism)}</strong></span>
        </div>
      </div>

      <div class="prob-list">
        ${visibleTypes
          .map(
            (item, idx) => `
          <div class="prob-row">
            <div class="prob-label" title="${esc(item.label)}">
              <span class="prob-rank">${idx + 1}.</span>${esc(item.label)}
            </div>
            <div class="prob-value">${item.probability.toFixed(1)}%</div>
            <div class="progress-track">
              <div class="progress-fill fill-purple" style="transform:scaleX(${Math.max(0.015, Math.min(1, item.probability / 100))});"></div>
            </div>
          </div>`,
          )
          .join('')}
      </div>
    </section>
  `;
}

function getGroupChannels(analysis, group) {
  const currents = analysis.features.channels.filter((c) => c.group === 'current').map((c) => c.channel);
  const voltages = analysis.features.channels.filter((c) => c.group === 'voltage').map((c) => c.channel);
  const others = analysis.features.channels.filter((c) => c.group === 'other').map((c) => c.channel);

  if (group === 'current' && currents.length) return { group: 'current', channels: currents, unit: 'A' };
  if (group === 'voltage' && voltages.length) return { group: 'voltage', channels: voltages, unit: 'kV' };
  if (currents.length) return { group: 'current', channels: currents, unit: 'A' };
  if (voltages.length) return { group: 'voltage', channels: voltages, unit: 'kV' };
  return {
    group: 'other',
    channels: others.length ? others : analysis.features.availableColumns,
    unit: 'pu',
  };
}

function renderChannelToggleButtons(container, channels) {
  container.innerHTML = channels
    .map((ch, idx) => {
      const color = getSeriesColor(ch, idx);
      const muted = Boolean(state.hiddenChannels[ch]);
      return `
        <button type="button" class="channel-btn ${muted ? 'muted' : ''}" data-channel="${esc(ch)}" aria-pressed="${!muted}">
          <span class="channel-swatch" style="background:${color};"></span>
          ${esc(ch)}
        </button>`;
    })
    .join('');
}

function renderAnomalyMetricsStrip(container, analysis) {
  const thr = state.anomalyThreshold;
  container.innerHTML = analysis.anomaly.metrics
    .map((m) => {
      const tone =
        m.score >= thr
          ? 'tone-red'
          : m.score >= thr * 0.6
            ? 'tone-amber'
            : 'tone-emerald';
      return `
        <div class="am-item">
          <div class="am-label" title="${esc(m.label)}">${esc(m.label)}</div>
          <div class="am-val-row">
            <span class="am-score ${tone}">${m.score.toFixed(1)}</span>
            <span class="am-detail">${esc(m.valueLabel)}</span>
          </div>
        </div>`;
    })
    .join('');
}

function syncDiagnosticsBentoLayout() {
  const a = state.analysis;
  const showPhasors = Boolean(
    a && state.modules.phasors && (a.diagnostics?.currentSequences || a.diagnostics?.voltageSequences),
  );
  const showFft = Boolean(a && state.modules.fft && a.diagnostics?.spectrum);
  const showExplain = Boolean(a && state.modules.explainability && a.explainability);

  const visiblePanels = [
    showPhasors ? els.modulePhasorsPanel : null,
    showFft ? els.moduleFftPanel : null,
    showExplain ? els.moduleExplainabilityPanel : null,
  ].filter(Boolean);

  els.advancedDiagnosticsGrid.classList.toggle('hidden', visiblePanels.length === 0);
  els.modulePhasorsPanel.classList.toggle('hidden', !showPhasors);
  els.moduleFftPanel.classList.toggle('hidden', !showFft);
  els.moduleExplainabilityPanel.classList.toggle('hidden', !showExplain);

  // Assign crisp 12-column spans: 1 visible -> 12, 2 visible -> 6+6, 3 visible -> 6+6 over 12
  [els.modulePhasorsPanel, els.moduleFftPanel, els.moduleExplainabilityPanel].forEach((panel) => {
    panel.classList.remove('span-6', 'span-12');
  });

  if (visiblePanels.length === 1) {
    visiblePanels[0].classList.add('span-12');
  } else if (visiblePanels.length === 2) {
    visiblePanels[0].classList.add('span-6');
    visiblePanels[1].classList.add('span-6');
  } else if (visiblePanels.length === 3) {
    els.modulePhasorsPanel.classList.add('span-6');
    els.moduleFftPanel.classList.add('span-6');
    els.moduleExplainabilityPanel.classList.add('span-12');
  }

  return { showPhasors, showFft, showExplain };
}

function renderAdvancedDiagnosticPanels() {
  const a = state.analysis;
  if (!a) return;

  const { showPhasors, showFft } = syncDiagnosticsBentoLayout();

  if (showPhasors) {
    const seq =
      state.phasorGroup === 'voltage' && a.diagnostics.voltageSequences
        ? a.diagnostics.voltageSequences
        : a.diagnostics.currentSequences || a.diagnostics.voltageSequences;

    const activeGrp = seq === a.diagnostics.voltageSequences ? 'voltage' : 'current';
    els.phasorGroupToggle.querySelectorAll('[data-phasor-group]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.phasorGroup === activeGrp);
    });

    const prefix = activeGrp === 'voltage' ? 'V' : 'I';
    const maxSeq = Math.max(1e-4, seq.positiveSeq, seq.negativeSeq, seq.zeroSeq);

    els.phasorSubtitle.textContent = `Negative-Sequence Unbalance (${prefix}2/${prefix}1): ${seq.unbalanceFactorPct.toFixed(1)}% · Reference ${seq.phasors[0]?.channel ?? 'Phase A'} = 0°`;

    const seqRows = [
      { label: `Positive Sequence (${prefix}1)`, val: seq.positiveSeq, fill: '#38BDF8' },
      { label: `Negative Sequence (${prefix}2)`, val: seq.negativeSeq, fill: '#F59E0B' },
      { label: `Zero Sequence (${prefix}0)`, val: seq.zeroSeq, fill: '#A855F7' },
    ];

    els.sequenceReadout.innerHTML = `
      ${seqRows
        .map(
          (row) => `
        <div class="seq-metric">
          <div class="seq-top">
            <span style="color:#CBD5E1;">${row.label}</span>
            <span class="mono tabular-nums" style="color:#F8FAFC;font-weight:600;">${row.val.toFixed(2)} ${esc(seq.unit)}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="background:${row.fill};transform:scaleX(${Math.max(0.02, Math.min(1, row.val / maxSeq))});"></div>
          </div>
        </div>`,
        )
        .join('')}
      <div class="phasor-angle-list mono tabular-nums">
        ${seq.phasors
          .map(
            (p) => `
            <div class="phasor-angle-cell">
              <span>${esc(p.channel)}</span>
              <strong>${p.magnitude.toFixed(1)} ${esc(seq.unit)}</strong>
              <span>&ang;${p.angleDeg.toFixed(1)}&deg;</span>
            </div>`,
          )
          .join('')}
      </div>
    `;

    renderPhasorDiagram(els.phasorCanvas, seq);
  }

  if (showFft) {
    const spec = a.diagnostics.spectrum;
    const useVolt = state.fftGroup === 'voltage' && spec.voltageHarmonics.length > 0;
    const activeFft = useVolt ? 'voltage' : 'current';

    els.fftGroupToggle.querySelectorAll('[data-fft-group]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.fftGroup === activeFft);
    });

    const harmonics = useVolt ? spec.voltageHarmonics : spec.currentHarmonics;
    const chName = useVolt ? spec.voltageChannel : spec.currentChannel;
    const thd = useVolt ? spec.thdVoltagePct : spec.thdCurrentPct;
    const unit = useVolt ? 'kV' : 'A';

    els.fftTitle.textContent = `FFT Harmonic Spectrum (${chName || 'Signal'})`;
    els.fftSubtitle.textContent = `Fundamental ${spec.fundamentalFreqHz} Hz · Orders H1–H13 (60–780 Hz) · THD = ${thd.toFixed(2)}%`;

    renderSpectrumChart(els.fftCanvas, els.fftTooltip, harmonics, unit);
  }
}

function renderExplainabilityPanel() {
  const a = state.analysis;
  const { showExplain } = syncDiagnosticsBentoLayout();
  if (!showExplain || !a) return;

  const ex = a.explainability;
  const winText = ex.saliencyWindowMs
    ? `Peak Saliency Window: ${ex.saliencyWindowMs.startMs.toFixed(1)} ms – ${ex.saliencyWindowMs.endMs.toFixed(1)} ms (highlighted on oscillogram)`
    : 'No localized high-saliency disturbance window detected';

  els.moduleExplainabilityPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Model Explainability &amp; Feature Attributions</h3>
        <p class="panel-subtitle mono tabular-nums">${esc(winText)}</p>
      </div>
    </div>

    <div class="explain-grid">
      <div class="explain-summary-box">
        <div>
          <div style="font-size:12px;font-weight:600;color:#94A3B8;margin-bottom:6px;">Diagnostic Explanation</div>
          <p>${esc(ex.summary)}</p>
        </div>
        <div class="explain-window-meta mono tabular-nums">
          ${
            ex.saliencyWindowMs
              ? `Active Saliency Band: ${ex.saliencyWindowMs.startMs.toFixed(1)} ms &rarr; ${ex.saliencyWindowMs.endMs.toFixed(1)} ms`
              : 'Steady-state baseline across full capture window'
          }
        </div>
      </div>

      <div class="explain-feature-list">
        ${ex.topFeatures
          .map((item) => {
            const fill =
              item.direction === 'ood'
                ? 'fill-orange'
                : item.direction === 'fault'
                  ? 'fill-amber'
                  : 'fill-emerald';
            return `
            <div class="explain-row">
              <div style="min-width:0;">
                <div style="font-size:13px;color:#E2E8F0;font-weight:500;">${esc(item.feature)}</div>
                <div class="mono" style="font-size:11px;color:#94A3B8;">${esc(item.valueLabel)}</div>
              </div>
              <div class="prob-value">${item.contributionPct.toFixed(1)}%</div>
              <div class="progress-track">
                <div class="progress-fill ${fill}" style="transform:scaleX(${Math.max(0.02, Math.min(1, item.contributionPct / 100))});"></div>
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </div>
  `;
}

function renderBatchPanel() {
  const show = Boolean(state.modules.batch);
  els.moduleBatchPanel.classList.toggle('hidden', !show);
  if (!show) return;

  const b = state.batchResult;
  const bodyHtml = state.batchLoading
    ? `<div class="batch-body" style="color:#94A3B8;font-size:13px;">Running batch CSV inference and computing confusion matrix...</div>`
    : !b
      ? `<div class="batch-body">
          <p style="font-size:13px;color:#94A3B8;line-height:1.6;">
            Upload multiple labeled CSV files (e.g., <code class="inline-code">f1_LG_A.csv</code>, <code class="inline-code">Overcurrent_ABC_02.csv</code>) or run the built-in 8-class benchmark to evaluate Overall Accuracy, Mechanism Accuracy, Macro-F1, and the Confusion Matrix across your active inference provider.
          </p>
        </div>`
      : `
        <div class="batch-kpi-row">
          <div class="batch-kpi-cell">
            <div class="kpi-label">Evaluated CSV Files</div>
            <div class="kpi-value-row">
              <span class="kpi-value">${b.totalFiles}</span>
              <span class="kpi-unit">(${b.labeledFiles} labeled)</span>
            </div>
          </div>
          <div class="batch-kpi-cell">
            <div class="kpi-label">Exact 28-Class Accuracy</div>
            <div class="kpi-value-row">
              <span class="kpi-value tone-emerald">${b.accuracyPct !== null ? b.accuracyPct.toFixed(1) + '%' : '--'}</span>
            </div>
          </div>
          <div class="batch-kpi-cell">
            <div class="kpi-label">Mechanism Accuracy</div>
            <div class="kpi-value-row">
              <span class="kpi-value tone-sky">${b.mechanismAccuracyPct !== null ? b.mechanismAccuracyPct.toFixed(1) + '%' : '--'}</span>
            </div>
          </div>
          <div class="batch-kpi-cell">
            <div class="kpi-label">Macro-F1 Score</div>
            <div class="kpi-value-row">
              <span class="kpi-value tone-purple">${b.macroF1Pct !== null ? b.macroF1Pct.toFixed(1) + '%' : '--'}</span>
            </div>
          </div>
        </div>

        <div class="batch-body">
          <div class="batch-split-grid ${b.confusionLabels.length > 0 ? '' : 'single-col'}">
            ${
              b.confusionLabels.length > 0
                ? `<div class="batch-subcard">
                    <h4 style="font-size:13px;font-weight:700;color:#E2E8F0;margin-bottom:10px;">
                      Confusion Matrix (Rows = Ground Truth, Cols = Predicted)
                    </h4>
                    <div class="table-wrap">
                      <table class="cm-table">
                        <thead>
                          <tr>
                            <th style="text-align:left;">True \\ Pred</th>
                            ${b.confusionLabels.map((lbl) => `<th>${esc(lbl)}</th>`).join('')}
                          </tr>
                        </thead>
                        <tbody>
                          ${b.confusionLabels
                            .map(
                              (trueLbl, rIdx) => `
                            <tr>
                              <th>${esc(trueLbl)}</th>
                              ${b.confusionMatrix[rIdx]
                                .map((count, cIdx) => {
                                  const cls =
                                    count === 0 ? 'cm-zero' : rIdx === cIdx ? 'cm-diag' : 'cm-err';
                                  return `<td class="${cls}">${count}</td>`;
                                })
                                .join('')}
                            </tr>`,
                            )
                            .join('')}
                        </tbody>
                      </table>
                    </div>
                  </div>`
                : ''
            }

            <div class="batch-subcard">
              <h4 style="font-size:13px;font-weight:700;color:#E2E8F0;margin-bottom:10px;">
                Per-File Batch Predictions
              </h4>
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Ground Truth</th>
                      <th>Predicted Type</th>
                      <th>Mechanism</th>
                      <th class="num-col">Confidence</th>
                      <th class="num-col">Anomaly</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${b.rows
                      .map(
                        (r) => `
                      <tr>
                        <td class="mono" style="font-size:12px;color:#F8FAFC;">${esc(r.fileName)}</td>
                        <td class="mono" style="font-size:12px;color:#94A3B8;">${esc(r.trueLabel || 'Unlabeled')}</td>
                        <td class="mono tone-purple" style="font-size:12px;font-weight:600;">${esc(r.predictedLabel)}</td>
                        <td class="mono tone-amber" style="font-size:12px;">${esc(r.predictedMechanism)}</td>
                        <td class="num-col" style="font-size:12px;">${r.confidence.toFixed(1)}%</td>
                        <td class="num-col" style="font-size:12px;">${r.anomalyScore.toFixed(1)}</td>
                        <td style="font-size:12px;font-weight:600;" class="${r.correct === true ? 'tone-emerald' : r.correct === false ? 'tone-red' : ''}">
                          ${r.correct === true ? 'Match' : r.correct === false ? 'Mismatch' : 'N/A'}
                        </td>
                      </tr>`,
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      `;

  els.moduleBatchPanel.innerHTML = `
    <div class="panel-flush-header">
      <div>
        <h3 class="panel-title">Batch CSV Evaluation &amp; Confusion Matrix</h3>
        <p class="panel-subtitle">
          Evaluate multiple labeled CSV files in one pass using canonical filenames (e.g., LG_A, LLG_BC, OpenCircuit_C, Healthy)
        </p>
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
        <button type="button" class="btn btn-secondary btn-sm" data-action="run-benchmark" ${state.batchLoading ? 'disabled' : ''}>
          Run 8-Class Benchmark
        </button>
        <button type="button" class="btn btn-primary btn-sm" data-action="upload-batch" ${state.batchLoading ? 'disabled' : ''}>
          Upload Multiple CSVs
        </button>
      </div>
    </div>
    ${bodyHtml}
  `;
}

function setZoomRange(nextStart, nextEnd) {
  let s = Math.max(0, Math.min(98, Number(nextStart) || 0));
  let e = Math.max(2, Math.min(100, Number(nextEnd) || 100));
  if (e - s < 2) {
    const mid = (s + e) / 2;
    s = Math.max(0, mid - 1);
    e = Math.min(100, s + 2);
  }
  state.zoomStartPct = Math.round(s * 10) / 10;
  state.zoomEndPct = Math.round(e * 10) / 10;

  if (els.ovZoomStart) els.ovZoomStart.value = String(Math.round(state.zoomStartPct));
  if (els.ovZoomEnd) els.ovZoomEnd.value = String(Math.round(state.zoomEndPct));
  if (els.modalZoomStart) els.modalZoomStart.value = String(state.zoomStartPct);
  if (els.modalZoomEnd) els.modalZoomEnd.value = String(state.zoomEndPct);
  if (els.cmpZoomStart) els.cmpZoomStart.value = String(state.zoomStartPct);
  if (els.cmpZoomEnd) els.cmpZoomEnd.value = String(state.zoomEndPct);

  renderActiveCharts();
}

function zoomByFactor(factor) {
  const span = state.zoomEndPct - state.zoomStartPct;
  const center = (state.zoomStartPct + state.zoomEndPct) / 2;
  const nextSpan = Math.max(2, Math.min(100, span * factor));
  let s = center - nextSpan / 2;
  let e = center + nextSpan / 2;
  if (s < 0) {
    e = Math.min(100, e - s);
    s = 0;
  }
  if (e > 100) {
    s = Math.max(0, s - (e - 100));
    e = 100;
  }
  setZoomRange(s, e);
}

function panWindow(direction) {
  const span = state.zoomEndPct - state.zoomStartPct;
  if (span >= 99.5) return;
  const step = Math.max(2, span * 0.25) * direction;
  let s = state.zoomStartPct + step;
  let e = state.zoomEndPct + step;
  if (s < 0) {
    e -= s;
    s = 0;
  }
  if (e > 100) {
    s -= e - 100;
    e = 100;
  }
  setZoomRange(s, e);
}

function focusOnFaultOnset() {
  const a = state.modalSourceAnalysis || state.analysis;
  if (!a || !a.waveform.length) return;
  const minT = a.waveform[0].time;
  const maxT = a.waveform[a.waveform.length - 1].time;
  const totalSpan = Math.max(1e-3, maxT - minT);
  const onset = a.features.faultInceptionMs;
  if (typeof onset !== 'number') {
    setZoomRange(20, 80);
    return;
  }
  const onsetPct = ((onset - minT) / totalSpan) * 100;
  const halfWindowPct = Math.min(20, Math.max(8, (22 / totalSpan) * 100));
  const s = Math.max(0, onsetPct - halfWindowPct * 0.7);
  const e = Math.min(100, onsetPct + halfWindowPct * 1.3);
  setZoomRange(s, e);
}

function openOscillogramModal(group, sourceAnalysis = null) {
  const target = sourceAnalysis || state.analysis;
  if (!target) return;
  state.modalSourceAnalysis = sourceAnalysis;
  state.modalWaveGroup = group || state.waveGroup;
  state.oscModalOpen = true;
  els.oscModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => renderOscillogramModal());
}

function closeOscillogramModal() {
  state.oscModalOpen = false;
  state.modalSourceAnalysis = null;
  els.oscModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (els.modalWaveformTooltip) els.modalWaveformTooltip.classList.add('hidden');
}

function renderOscillogramModal() {
  const a = state.modalSourceAnalysis || state.analysis;
  if (!state.oscModalOpen || !a) return;

  const hasCurrent = a.features.channels.some((c) => c.group === 'current');
  const hasVoltage = a.features.channels.some((c) => c.group === 'voltage');
  const saliencyOverlay = state.modules.explainability ? a.explainability?.temporalSaliency : null;
  const resolved = getGroupChannels(a, state.modalWaveGroup);

  els.modalWaveTitle.textContent =
    resolved.group === 'current'
      ? '3-Phase Current Oscillogram — Zoom Focus'
      : resolved.group === 'voltage'
        ? '3-Phase Voltage Oscillogram — Zoom Focus'
        : 'Signal Channel Oscillogram — Zoom Focus';

  const rows = a.waveform;
  const startIdx = Math.floor((rows.length - 1) * (state.zoomStartPct / 100));
  const endIdx = Math.max(startIdx + 2, Math.ceil((rows.length - 1) * (state.zoomEndPct / 100)));
  const slice = rows.slice(startIdx, endIdx + 1);
  const tStart = slice[0]?.time ?? 0;
  const tEnd = slice[slice.length - 1]?.time ?? a.features.durationMs;
  const deltaT = Math.max(0, tEnd - tStart);
  const zoomFactor = 100 / Math.max(2, state.zoomEndPct - state.zoomStartPct);

  els.modalWaveSubtitle.textContent = `${a.fileName} · ${tStart.toFixed(2)} ms → ${tEnd.toFixed(2)} ms (Δ ${deltaT.toFixed(2)} ms) · ${slice.length.toLocaleString()} pts in view`;
  els.modalZoomBadge.textContent = `${zoomFactor.toFixed(1)}x`;

  els.modalWaveGroupToggle.classList.toggle('hidden', !(hasCurrent && hasVoltage));
  els.modalWaveGroupToggle.querySelectorAll('[data-modal-wave-group]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.modalWaveGroup === resolved.group);
  });

  renderChannelToggleButtons(els.modalChannelToggles, resolved.channels);
  els.modalTriggerLabel.textContent =
    a.features.faultInceptionMs !== null
      ? `Fault Trigger: ${a.features.faultInceptionMs.toFixed(2)} ms`
      : 'No fault trigger';

  els.modalZoomStart.value = String(state.zoomStartPct);
  els.modalZoomEnd.value = String(state.zoomEndPct);
  els.modalFocusOnset.disabled = a.features.faultInceptionMs === null;

  renderWaveformChart(els.modalWaveformCanvas, els.modalWaveformTooltip, {
    rows: a.waveform,
    channels: resolved.channels,
    hiddenMap: state.hiddenChannels,
    unit: resolved.unit,
    onsetMs: a.features.faultInceptionMs,
    zoomStartPct: state.zoomStartPct,
    zoomEndPct: state.zoomEndPct,
    saliencyPoints: saliencyOverlay,
    enlarged: true,
    onZoomRange: (ns, ne) => setZoomRange(ns, ne),
  });

  // Live recalculated per-phase statistics strictly inside the zoomed time slice
  const activeChannels = resolved.channels.filter((ch) => !state.hiddenChannels[ch]);
  els.modalWindowStats.innerHTML = activeChannels
    .map((ch) => {
      const color = getSeriesColor(ch, resolved.channels.indexOf(ch));
      let minV = Infinity;
      let maxV = -Infinity;
      let sumSq = 0;
      let count = 0;
      for (const row of slice) {
        const v = row[ch];
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
          sumSq += v * v;
          count += 1;
        }
      }
      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      const pkPk = count > 0 ? maxV - minV : 0;
      return `
        <div class="osc-stat-card">
          <div class="osc-stat-head">
            <span class="mono" style="color:${color};">${esc(ch)} <span style="color:#64748B;font-weight:400;">(${esc(resolved.unit)})</span></span>
            <span class="mono tabular-nums" style="color:#94A3B8;font-size:11px;">Zoomed Window</span>
          </div>
          <div class="osc-stat-grid mono tabular-nums">
            <div class="osc-stat-item"><span>RMS</span><strong>${rms.toFixed(2)}</strong></div>
            <div class="osc-stat-item"><span>Max</span><strong>${count ? maxV.toFixed(1) : '--'}</strong></div>
            <div class="osc-stat-item"><span>Min</span><strong>${count ? minV.toFixed(1) : '--'}</strong></div>
            <div class="osc-stat-item"><span>Pk-Pk</span><strong>${pkPk.toFixed(1)}</strong></div>
          </div>
        </div>`;
    })
    .join('');
}

function getCompareOptionValue(analysis, sampleId) {
  if (sampleId) return `sample:${sampleId}`;
  if (analysis) return `history:${analysis.id}`;
  return '';
}

function populateCompareSelectors() {
  if (!els.cmpSelectA || !els.cmpSelectB) return;

  const sampleFileNames = new Set(state.samples.map((s) => s.fileName));
  const uploadedMap = new Map();

  for (const h of state.history) {
    if (!sampleFileNames.has(h.fileName)) {
      uploadedMap.set(h.id, h);
    }
  }
  if (state.analysis && !state.activeSampleId && !uploadedMap.has(state.analysis.id)) {
    uploadedMap.set(state.analysis.id, state.analysis);
  }
  if (
    state.compareAnalysis &&
    !state.compareSampleId &&
    !uploadedMap.has(state.compareAnalysis.id)
  ) {
    uploadedMap.set(state.compareAnalysis.id, state.compareAnalysis);
  }

  const uploadedRuns = Array.from(uploadedMap.values());

  const uploadedGroupHtml = uploadedRuns.length
    ? `<optgroup label="Uploaded CSV Signals">${uploadedRuns
        .map(
          (run) =>
            `<option value="history:${esc(run.id)}">${esc(run.fileName)} · ${esc(run.faultType.topLabel)}</option>`,
        )
        .join('')}</optgroup>`
    : '';

  const samplesGroupHtml = `<optgroup label="Built-in Fault Samples">${state.samples
    .map(
      (s) =>
        `<option value="sample:${esc(s.id)}">${esc(s.fileName)}${s.label ? ` · ${esc(s.label)}` : ''}</option>`,
    )
    .join('')}</optgroup>`;

  const optionsHtml = `${uploadedGroupHtml}${samplesGroupHtml}`;
  els.cmpSelectA.innerHTML = optionsHtml;
  els.cmpSelectB.innerHTML = optionsHtml;

  const valA = getCompareOptionValue(state.analysis, state.activeSampleId);
  const valB = getCompareOptionValue(state.compareAnalysis, state.compareSampleId);
  if (valA) els.cmpSelectA.value = valA;
  if (valB) els.cmpSelectB.value = valB;
}

function computeSharedYRange(analysisA, analysisB, group) {
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (const analysis of [analysisA, analysisB]) {
    if (!analysis || !analysis.waveform.length) continue;
    const resolved = getGroupChannels(analysis, group);
    const activeChannels = resolved.channels.filter((ch) => !state.hiddenChannels[ch]);
    const channelsToScan = activeChannels.length ? activeChannels : resolved.channels;

    const rows = analysis.waveform;
    const startIdx = Math.floor((rows.length - 1) * (state.zoomStartPct / 100));
    const endIdx = Math.max(startIdx + 2, Math.ceil((rows.length - 1) * (state.zoomEndPct / 100)));

    for (let i = startIdx; i <= Math.min(endIdx, rows.length - 1); i += 1) {
      const row = rows[i];
      for (const ch of channelsToScan) {
        const v = row[ch];
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
      }
    }
  }

  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return null;
  const span = maxVal - minVal || 1;
  const pad = span * 0.1;
  return { minY: minVal - pad, maxY: maxVal + pad };
}

function renderComparePane(slot, analysis, fixedYRange) {
  const isA = slot === 'a';
  const titleEl = isA ? els.cmpATitle : els.cmpBTitle;
  const subtitleEl = isA ? els.cmpASubtitle : els.cmpBSubtitle;
  const summaryEl = isA ? els.cmpASummary : els.cmpBSummary;
  const togglesEl = isA ? els.cmpAToggles : els.cmpBToggles;
  const triggerEl = isA ? els.cmpATrigger : els.cmpBTrigger;
  const waveCanvas = isA ? els.cmpAWaveCanvas : els.cmpBWaveCanvas;
  const waveTooltip = isA ? els.cmpAWaveTooltip : els.cmpBWaveTooltip;
  const anomValEl = isA ? els.cmpAAnomVal : els.cmpBAnomVal;
  const anomCanvas = isA ? els.cmpAAnomCanvas : els.cmpBAnomCanvas;
  const anomTooltip = isA ? els.cmpAAnomTooltip : els.cmpBAnomTooltip;
  const focusBtn = isA ? els.cmpAFocusBtn : els.cmpBFocusBtn;

  if (!analysis) {
    titleEl.textContent =
      !isA && state.compareLoading ? 'Analyzing Signal B...' : 'Select or upload a CSV signal';
    subtitleEl.textContent =
      !isA && state.compareLoading
        ? 'Extracting 3-phase features and sliding-window residuals...'
        : 'Choose a sample or upload a second fault CSV above';
    summaryEl.innerHTML = '';
    togglesEl.innerHTML = '';
    triggerEl.textContent = '';
    anomValEl.textContent = '--';
    if (focusBtn) focusBtn.disabled = true;
    return;
  }

  if (focusBtn) focusBtn.disabled = false;

  const f = analysis.features;
  const eff = getEffectiveAnomalyState(analysis);
  const verdictTone = eff.isOod
    ? 'tone-orange'
    : eff.faultDetected
      ? 'tone-red'
      : 'tone-emerald';
  const mechTone =
    analysis.mechanism.topMechanism === 'ShortCircuit'
      ? 'tone-amber'
      : analysis.mechanism.topMechanism === 'Healthy'
        ? 'tone-emerald'
        : 'tone-purple';
  const swellHigher = f.maxVoltageSwellPct > f.maxVoltageSagPct;

  titleEl.textContent = analysis.fileName;
  subtitleEl.textContent = `${f.rowCount.toLocaleString()} samples · ${f.samplingRateHz.toLocaleString()} Hz · ${f.durationMs.toFixed(1)} ms`;

  summaryEl.innerHTML = `
    <div class="compare-mini-cell">
      <span>Verdict</span>
      <strong class="${verdictTone}">${esc(eff.detectionLabel)}</strong>
    </div>
    <div class="compare-mini-cell">
      <span>28-Class Type</span>
      <strong class="mono ${mechTone}" title="${esc(analysis.faultType.topLabel)}">${esc(analysis.faultType.topLabel)}</strong>
    </div>
    <div class="compare-mini-cell">
      <span>Peak Current</span>
      <strong class="mono tabular-nums">${f.peakFaultCurrent.toLocaleString()} A</strong>
    </div>
    <div class="compare-mini-cell">
      <span>${swellHigher ? 'Max Swell' : 'Max Sag'}</span>
      <strong class="mono tabular-nums">${swellHigher ? '+' + f.maxVoltageSwellPct.toFixed(1) : '-' + f.maxVoltageSagPct.toFixed(1)}%</strong>
    </div>
  `;

  const resolved = getGroupChannels(analysis, state.compareGroup);
  const saliencyOverlay = state.modules.explainability
    ? analysis.explainability?.temporalSaliency
    : null;

  renderChannelToggleButtons(togglesEl, resolved.channels);
  triggerEl.textContent =
    f.faultInceptionMs !== null ? `Trigger: ${f.faultInceptionMs.toFixed(2)} ms` : 'No trigger';

  renderWaveformChart(waveCanvas, waveTooltip, {
    rows: analysis.waveform,
    channels: resolved.channels,
    hiddenMap: state.hiddenChannels,
    unit: resolved.unit,
    onsetMs: f.faultInceptionMs,
    zoomStartPct: state.zoomStartPct,
    zoomEndPct: state.zoomEndPct,
    saliencyPoints: saliencyOverlay,
    fixedYRange: state.compareLockY ? fixedYRange : null,
    onZoomRange: (ns, ne) => setZoomRange(ns, ne),
    onRequestExpand: () => openOscillogramModal(resolved.group, analysis),
  });

  anomValEl.textContent = `${eff.score.toFixed(1)} / 100 · ${eff.statusLabel}`;
  anomValEl.className = `mono tabular-nums ${verdictTone}`;
  renderAnomalyAreaChart(anomCanvas, anomTooltip, analysis, state.anomalyThreshold);
}

function formatSignedDelta(delta, decimals, suffix = '') {
  if (!Number.isFinite(delta)) return '--';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(decimals)}${suffix}`;
}

function renderCompareDeltaPanel(a, b) {
  if (!els.cmpDeltaPanel) return;
  if (!a || !b) {
    els.cmpDeltaPanel.innerHTML = `
      <div class="panel-flush-header">
        <div>
          <h3 class="panel-title">Differential Telemetry Comparison (Signal A vs Signal B)</h3>
          <p class="panel-subtitle">Load both Signal A and Signal B to inspect side-by-side deltas</p>
        </div>
      </div>`;
    return;
  }

  const effA = getEffectiveAnomalyState(a);
  const effB = getEffectiveAnomalyState(b);
  const fA = a.features;
  const fB = b.features;

  const thdCurA = a.diagnostics?.spectrum?.thdCurrentPct ?? 0;
  const thdCurB = b.diagnostics?.spectrum?.thdCurrentPct ?? 0;
  const unbalA = a.diagnostics?.currentSequences?.unbalanceFactorPct ?? 0;
  const unbalB = b.diagnostics?.currentSequences?.unbalanceFactorPct ?? 0;
  const onsetDelta =
    fA.faultInceptionMs !== null && fB.faultInceptionMs !== null
      ? formatSignedDelta(fB.faultInceptionMs - fA.faultInceptionMs, 2, ' ms')
      : 'N/A';

  const rows = [
    {
      metric: 'Step 1 · Detection Verdict',
      valA: effA.detectionLabel,
      valB: effB.detectionLabel,
      delta: effA.detectionLabel === effB.detectionLabel ? 'Match' : 'Divergent',
      deltaTone: effA.detectionLabel === effB.detectionLabel ? 'tone-emerald' : 'tone-amber',
    },
    {
      metric: 'Step 2 · Event Mechanism',
      valA: a.mechanism.topMechanism,
      valB: b.mechanism.topMechanism,
      delta: a.mechanism.topMechanism === b.mechanism.topMechanism ? 'Match' : 'Different',
      deltaTone:
        a.mechanism.topMechanism === b.mechanism.topMechanism ? 'tone-emerald' : 'tone-purple',
    },
    {
      metric: 'Step 3 · 28-Class Prediction',
      valA: `${a.faultType.topLabel} (${(a.faultType.confidence * 100).toFixed(1)}%)`,
      valB: `${b.faultType.topLabel} (${(b.faultType.confidence * 100).toFixed(1)}%)`,
      delta: a.faultType.topLabel === b.faultType.topLabel ? 'Same Class' : 'Distinct Class',
      deltaTone: a.faultType.topLabel === b.faultType.topLabel ? 'tone-sky' : 'tone-amber',
    },
    {
      metric: 'Fault Inception Time',
      valA: fA.faultInceptionMs !== null ? `${fA.faultInceptionMs.toFixed(2)} ms` : 'None',
      valB: fB.faultInceptionMs !== null ? `${fB.faultInceptionMs.toFixed(2)} ms` : 'None',
      delta: onsetDelta,
      deltaTone: '',
    },
    {
      metric: 'Peak Phase Current',
      valA: `${fA.peakFaultCurrent.toLocaleString()} A`,
      valB: `${fB.peakFaultCurrent.toLocaleString()} A`,
      delta: formatSignedDelta(fB.peakFaultCurrent - fA.peakFaultCurrent, 1, ' A'),
      deltaTone: fB.peakFaultCurrent >= fA.peakFaultCurrent ? 'tone-amber' : 'tone-sky',
    },
    {
      metric: 'Zero-Sequence Current (I0)',
      valA: `${fA.zeroSequenceCurrentRms.toFixed(1)} A RMS`,
      valB: `${fB.zeroSequenceCurrentRms.toFixed(1)} A RMS`,
      delta: formatSignedDelta(fB.zeroSequenceCurrentRms - fA.zeroSequenceCurrentRms, 1, ' A'),
      deltaTone: '',
    },
    {
      metric: 'Max Voltage Sag',
      valA: `-${fA.maxVoltageSagPct.toFixed(1)}%`,
      valB: `-${fB.maxVoltageSagPct.toFixed(1)}%`,
      delta: formatSignedDelta(fB.maxVoltageSagPct - fA.maxVoltageSagPct, 1, ' pp'),
      deltaTone: '',
    },
    {
      metric: 'Max Voltage Swell',
      valA: `+${fA.maxVoltageSwellPct.toFixed(1)}%`,
      valB: `+${fB.maxVoltageSwellPct.toFixed(1)}%`,
      delta: formatSignedDelta(fB.maxVoltageSwellPct - fA.maxVoltageSwellPct, 1, ' pp'),
      deltaTone: '',
    },
    {
      metric: 'Anomaly Score (0–100)',
      valA: effA.score.toFixed(1),
      valB: effB.score.toFixed(1),
      delta: formatSignedDelta(effB.score - effA.score, 1),
      deltaTone: Math.abs(effB.score - effA.score) >= 15 ? 'tone-amber' : '',
    },
    {
      metric: '60 Hz Reconstruction Residual',
      valA: `${a.anomaly.reconstructionErrorPct.toFixed(1)}%`,
      valB: `${b.anomaly.reconstructionErrorPct.toFixed(1)}%`,
      delta: formatSignedDelta(
        b.anomaly.reconstructionErrorPct - a.anomaly.reconstructionErrorPct,
        1,
        ' pp',
      ),
      deltaTone: '',
    },
    {
      metric: 'Current Harmonic Distortion (THD)',
      valA: `${thdCurA.toFixed(2)}%`,
      valB: `${thdCurB.toFixed(2)}%`,
      delta: formatSignedDelta(thdCurB - thdCurA, 2, ' pp'),
      deltaTone: '',
    },
    {
      metric: 'Negative-Seq Unbalance (I2/I1)',
      valA: `${unbalA.toFixed(1)}%`,
      valB: `${unbalB.toFixed(1)}%`,
      delta: formatSignedDelta(unbalB - unbalA, 1, ' pp'),
      deltaTone: '',
    },
  ];

  els.cmpDeltaPanel.innerHTML = `
    <div class="panel-flush-header">
      <div>
        <h3 class="panel-title">Differential Transient &amp; Triage Comparison</h3>
        <p class="panel-subtitle mono">
          <span class="tone-sky">Signal A: ${esc(a.fileName)}</span>
          &nbsp;&middot;&nbsp;
          <span class="tone-purple">Signal B: ${esc(b.fileName)}</span>
        </p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Diagnostic Parameter</th>
            <th class="num-col tone-sky">Signal A</th>
            <th class="num-col tone-purple">Signal B</th>
            <th class="num-col">Delta (B &minus; A)</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td style="color:#E2E8F0;font-weight:500;">${esc(r.metric)}</td>
              <td class="num-col">${esc(r.valA)}</td>
              <td class="num-col">${esc(r.valB)}</td>
              <td class="num-col ${r.deltaTone}" style="font-weight:600;">${esc(r.delta)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSplitScreenComparison() {
  const a = state.analysis;
  const b = state.compareAnalysis;
  if (!a) return;

  populateCompareSelectors();

  // Sync compare control deck states
  const anyVoltage =
    a.features.channels.some((c) => c.group === 'voltage') ||
    Boolean(b && b.features.channels.some((c) => c.group === 'voltage'));
  if (!anyVoltage && state.compareGroup === 'voltage') {
    state.compareGroup = 'current';
  }
  els.cmpWaveGroupToggle.querySelectorAll('[data-cmp-group]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.cmpGroup === state.compareGroup);
    if (btn.dataset.cmpGroup === 'voltage') {
      btn.disabled = !anyVoltage;
    }
  });

  if (els.cmpLockYBtn) {
    els.cmpLockYBtn.classList.toggle('on', state.compareLockY);
    els.cmpLockYBtn.setAttribute('aria-pressed', String(state.compareLockY));
  }
  if (els.cmpZoomStart) els.cmpZoomStart.value = String(state.zoomStartPct);
  if (els.cmpZoomEnd) els.cmpZoomEnd.value = String(state.zoomEndPct);

  const sharedY = state.compareLockY && b ? computeSharedYRange(a, b, state.compareGroup) : null;

  renderComparePane('a', a, sharedY);
  renderComparePane('b', b, sharedY);
  renderCompareDeltaPanel(a, b);
}

function renderActiveCharts() {
  const a = state.analysis;
  if (!a) return;

  const hasCurrent = a.features.channels.some((c) => c.group === 'current');
  const hasVoltage = a.features.channels.some((c) => c.group === 'voltage');
  const saliencyOverlay = state.modules.explainability ? a.explainability?.temporalSaliency : null;

  // Overview charts
  if (state.activeTab === 'overview') {
    const resolved = getGroupChannels(a, state.waveGroup);
    els.ovWaveTitle.textContent =
      resolved.group === 'current'
        ? '3-Phase Current Oscillogram'
        : resolved.group === 'voltage'
          ? '3-Phase Voltage Oscillogram'
          : 'Signal Channel Oscillogram';

    els.ovWaveSubtitle.textContent = `${a.features.rowCount.toLocaleString()} samples · ${a.features.samplingRateHz.toLocaleString()} Hz · Window ${a.features.durationMs.toFixed(1)} ms${saliencyOverlay ? ' · Saliency overlay ON' : ''}`;
    els.ovWaveGroupToggle.classList.toggle('hidden', !(hasCurrent && hasVoltage));
    els.ovWaveGroupToggle.querySelectorAll('[data-wave-group]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.waveGroup === resolved.group);
    });

    renderChannelToggleButtons(els.ovChannelToggles, resolved.channels);
    els.ovTriggerLabel.textContent =
      a.features.faultInceptionMs !== null
        ? `Fault Trigger: ${a.features.faultInceptionMs.toFixed(2)} ms`
        : '';

    renderWaveformChart(els.ovWaveformCanvas, els.ovWaveformTooltip, {
      rows: a.waveform,
      channels: resolved.channels,
      hiddenMap: state.hiddenChannels,
      unit: resolved.unit,
      onsetMs: a.features.faultInceptionMs,
      zoomStartPct: state.zoomStartPct,
      zoomEndPct: state.zoomEndPct,
      saliencyPoints: saliencyOverlay,
      onZoomRange: (ns, ne) => setZoomRange(ns, ne),
      onRequestExpand: () => openOscillogramModal(resolved.group),
    });

    // Analytics panel + live Threshold Calibrator
    els.ovAnalyticsTabs.querySelectorAll('[data-chart-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.chartTab === state.analyticsTab);
    });

    const showCalibrator = state.modules.threshold && state.analyticsTab === 'anomaly';
    els.thresholdCalibrator.classList.toggle('hidden', !showCalibrator);
    els.thresholdLiveReadout.textContent = state.anomalyThreshold.toFixed(1);
    els.thresholdSlider.value = String(state.anomalyThreshold);

    const preferVoltageRms =
      (a.mechanism.topMechanism === 'Overvoltage' || a.mechanism.topMechanism === 'Undervoltage') &&
      hasVoltage;

    if (state.analyticsTab === 'anomaly') {
      els.ovAnalyticsTitle.textContent = 'Sliding-Window Anomaly & Reconstruction Score';
      els.ovAnalyticsSubtitle.textContent = `60 Hz fundamental reconstruction residual over time · Active Threshold = ${state.anomalyThreshold.toFixed(1)}`;
      renderAnomalyAreaChart(els.ovAnalyticsCanvas, els.ovAnalyticsTooltip, a, state.anomalyThreshold);
      els.ovAnomalyMetricsStrip.classList.remove('hidden');
      renderAnomalyMetricsStrip(els.ovAnomalyMetricsStrip, a);
    } else if (state.analyticsTab === 'rms') {
      els.ovAnalyticsTitle.textContent = preferVoltageRms
        ? 'Pre-Fault vs Event Voltage RMS (kV)'
        : 'Pre-Fault vs Event Current RMS (A)';
      els.ovAnalyticsSubtitle.textContent =
        'Per-phase pre-event baseline compared against post-inception RMS magnitude';
      const rmsChannels = a.features.channels.filter((c) =>
        preferVoltageRms ? c.group === 'voltage' : c.group === 'current',
      );
      renderRmsBarChart(
        els.ovAnalyticsCanvas,
        els.ovAnalyticsTooltip,
        rmsChannels.length ? rmsChannels : a.features.channels.slice(0, 6),
      );
      els.ovAnomalyMetricsStrip.classList.add('hidden');
    } else if (state.analyticsTab === 'mechanisms') {
      els.ovAnalyticsTitle.textContent = 'Fault Mechanism Probability Distribution';
      els.ovAnalyticsSubtitle.textContent =
        'ShortCircuit vs Overcurrent, Overvoltage, Undervoltage, OpenCircuit, and Healthy';
      renderHorizontalProbChart(
        els.ovAnalyticsCanvas,
        els.ovAnalyticsTooltip,
        a.mechanism.probabilities,
        '#F59E0B',
      );
      els.ovAnomalyMetricsStrip.classList.add('hidden');
    } else {
      els.ovAnalyticsTitle.textContent = 'Top Fault Type Probabilities (28-Class)';
      els.ovAnalyticsSubtitle.textContent =
        'Highest-ranked fault labels from the canonical fault_type_table.m taxonomy';
      renderHorizontalProbChart(
        els.ovAnalyticsCanvas,
        els.ovAnalyticsTooltip,
        a.faultType.probabilities.slice(0, 6),
        '#A855F7',
      );
      els.ovAnomalyMetricsStrip.classList.add('hidden');
    }

    renderAdvancedDiagnosticPanels();
  }

  // Waveforms tab (Single Signal vs Split-Screen Compare)
  if (state.activeTab === 'waveforms') {
    els.wfModeToggle.querySelectorAll('[data-wf-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.wfMode === state.wfMode);
    });
    const isCompare = state.wfMode === 'compare';
    els.wfSingleWorkspace.classList.toggle('hidden', isCompare);
    els.wfCompareWorkspace.classList.toggle('hidden', !isCompare);

    if (!isCompare) {
      const cur = getGroupChannels(a, 'current');
      els.wfCurrentSubtitle.textContent = `${a.features.rowCount.toLocaleString()} samples · ${a.features.samplingRateHz.toLocaleString()} Hz · Window ${a.features.durationMs.toFixed(1)} ms`;
      renderChannelToggleButtons(els.wfCurrentToggles, cur.channels);
      renderWaveformChart(els.wfCurrentCanvas, els.wfCurrentTooltip, {
        rows: a.waveform,
        channels: cur.channels,
        hiddenMap: state.hiddenChannels,
        unit: cur.unit,
        onsetMs: a.features.faultInceptionMs,
        zoomStartPct: state.zoomStartPct,
        zoomEndPct: state.zoomEndPct,
        saliencyPoints: saliencyOverlay,
        onZoomRange: (ns, ne) => setZoomRange(ns, ne),
        onRequestExpand: () => openOscillogramModal('current', a),
      });

      els.wfVoltagePanel.classList.toggle('hidden', !hasVoltage);
      if (els.wfDualGrid) {
        els.wfDualGrid.classList.toggle('single-visible', !hasVoltage);
      }
      if (hasVoltage) {
        const volt = getGroupChannels(a, 'voltage');
        els.wfVoltageSubtitle.textContent = `${a.features.rowCount.toLocaleString()} samples · ${a.features.samplingRateHz.toLocaleString()} Hz · Window ${a.features.durationMs.toFixed(1)} ms`;
        renderChannelToggleButtons(els.wfVoltageToggles, volt.channels);
        renderWaveformChart(els.wfVoltageCanvas, els.wfVoltageTooltip, {
          rows: a.waveform,
          channels: volt.channels,
          hiddenMap: state.hiddenChannels,
          unit: volt.unit,
          onsetMs: a.features.faultInceptionMs,
          zoomStartPct: state.zoomStartPct,
          zoomEndPct: state.zoomEndPct,
          saliencyPoints: saliencyOverlay,
          onZoomRange: (ns, ne) => setZoomRange(ns, ne),
          onRequestExpand: () => openOscillogramModal('voltage', a),
        });
      }

      els.wfAnomalySubtitle.textContent = `60 Hz fundamental reconstruction residual over time · Active Threshold = ${state.anomalyThreshold.toFixed(1)}`;
      renderAnomalyAreaChart(els.wfAnomalyCanvas, els.wfAnomalyTooltip, a, state.anomalyThreshold);
      renderAnomalyMetricsStrip(els.wfAnomalyMetricsStrip, a);
    } else {
      renderSplitScreenComparison();
    }
  }

  // Keep enlarged modal synced if open
  if (state.oscModalOpen) {
    renderOscillogramModal();
  }

  // Statistics tab
  if (state.activeTab === 'statistics') {
    const preferVoltageRms =
      (a.mechanism.topMechanism === 'Overvoltage' || a.mechanism.topMechanism === 'Undervoltage') &&
      hasVoltage;
    els.stRmsTitle.textContent = preferVoltageRms
      ? 'Pre-Fault vs Event Voltage RMS (kV)'
      : 'Pre-Fault vs Event Current RMS (A)';
    const rmsChannels = a.features.channels.filter((c) =>
      preferVoltageRms ? c.group === 'voltage' : c.group === 'current',
    );
    renderRmsBarChart(
      els.stRmsCanvas,
      els.stRmsTooltip,
      rmsChannels.length ? rmsChannels : a.features.channels.slice(0, 6),
    );
  }
}

function buildSummaryTablesHtml() {
  const a = state.analysis;
  if (!a) return '';

  const filtered = a.features.channels
    .filter((ch) => (state.statsGroupFilter === 'all' ? true : ch.group === state.statsGroupFilter))
    .slice()
    .sort((x, y) => {
      const xv = x[state.statsSortKey];
      const yv = y[state.statsSortKey];
      if (typeof xv === 'string' && typeof yv === 'string') {
        return state.statsSortAsc ? xv.localeCompare(yv) : yv.localeCompare(xv);
      }
      return state.statsSortAsc ? Number(xv) - Number(yv) : Number(yv) - Number(xv);
    });

  const channelRows = filtered
    .map((ch) => {
      const elevated =
        (ch.group === 'current' && (ch.faultRatio >= 1.5 || ch.faultRatio <= 0.5)) ||
        (ch.group === 'voltage' && (ch.faultRatio <= 0.85 || ch.faultRatio >= 1.15));
      return `
        <tr>
          <td>
            <div class="channel-main">${esc(ch.channel)}</div>
            <div class="channel-sub">${esc(ch.label)}</div>
          </td>
          <td class="num-col">${ch.preFaultRms.toFixed(2)} <span style="color:#64748B;font-size:11px;">${esc(ch.unit)}</span></td>
          <td class="num-col" style="color:#F8FAFC;font-weight:500;">${ch.faultRms.toFixed(2)} <span style="color:#64748B;font-size:11px;">${esc(ch.unit)}</span></td>
          <td class="num-col ${elevated ? 'tone-amber' : ''}" style="font-weight:600;">${ch.faultRatio.toFixed(2)}x</td>
          <td class="num-col">${ch.min.toFixed(2)}</td>
          <td class="num-col">${ch.max.toFixed(2)}</td>
          <td class="num-col">${ch.peakToPeak.toFixed(2)}</td>
          <td class="num-col">${ch.stdDev.toFixed(2)}</td>
        </tr>`;
    })
    .join('');

  const historyHtml =
    state.history.length > 1
      ? `
      <section class="panel-flush no-print">
        <div class="panel-flush-header">
          <div>
            <h3 class="panel-title">Session Analysis Runs</h3>
            <p class="panel-subtitle">Click any prior run to reload its diagnostic triage and waveforms</p>
          </div>
          <span class="mono tabular-nums" style="font-size:12px;color:#94A3B8;">${state.history.length} runs cached</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Signal File</th>
                <th>Detection</th>
                <th>Mechanism</th>
                <th>Fault Type</th>
                <th class="num-col">Anomaly</th>
                <th class="num-col">Peak Current</th>
                <th class="num-col">Inference</th>
              </tr>
            </thead>
            <tbody>
              ${state.history
                .map((run) => {
                  const active = run.id === a.id;
                  const detTone = run.anomaly.isOutOfDistribution
                    ? 'tone-orange'
                    : run.detection.faultDetected
                      ? 'tone-red'
                      : 'tone-emerald';
                  return `
                  <tr class="clickable ${active ? 'active-row' : ''}" data-history-id="${esc(run.id)}">
                    <td class="mono" style="font-size:12px;color:#F8FAFC;font-weight:500;">${esc(run.fileName)}</td>
                    <td class="${detTone}" style="font-size:12px;font-weight:600;">${esc(run.detection.statusLabel)} (${run.detection.confidence.toFixed(1)}%)</td>
                    <td class="mono tone-amber" style="font-size:12px;">${esc(run.mechanism.topMechanism)} (${run.mechanism.topProbability.toFixed(1)}%)</td>
                    <td class="mono tone-purple" style="font-size:12px;">${esc(run.faultType.topLabel)} (${run.faultType.topProbability.toFixed(1)}%)</td>
                    <td class="num-col" style="font-size:12px;">${run.anomaly.anomalyScore.toFixed(1)}</td>
                    <td class="num-col" style="font-size:12px;">${run.features.peakFaultCurrent.toLocaleString()} A</td>
                    <td class="num-col" style="font-size:12px;color:#94A3B8;">${run.inference.inferenceTimeMs.toFixed(1)} ms</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </section>`
      : '';

  return `
    <section class="panel-flush">
      <div class="panel-flush-header">
        <div>
          <h3 class="panel-title">Channel Summary Statistics</h3>
          <p class="panel-subtitle">
            Per-phase time-domain metrics computed across ${a.features.rowCount.toLocaleString()} samples in ${esc(a.fileName)}
          </p>
        </div>

        <div class="no-print" style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;">
          <div class="segmented-control">
            ${['all', 'current', 'voltage']
              .map(
                (grp) => `
              <button type="button" class="seg-btn ${state.statsGroupFilter === grp ? 'active' : ''}" data-stats-group="${grp}" style="text-transform:capitalize;">
                ${grp}
              </button>`,
              )
              .join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-json">
            Export Report JSON
          </button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th><button type="button" class="sort-btn" data-sort-key="channel">Channel &#8597;</button></th>
              <th class="num-col"><button type="button" class="sort-btn" data-sort-key="preFaultRms">Pre-Fault RMS &#8597;</button></th>
              <th class="num-col"><button type="button" class="sort-btn" data-sort-key="faultRms">Fault RMS &#8597;</button></th>
              <th class="num-col"><button type="button" class="sort-btn" data-sort-key="faultRatio">Ratio (x) &#8597;</button></th>
              <th class="num-col"><button type="button" class="sort-btn" data-sort-key="min">Min &#8597;</button></th>
              <th class="num-col"><button type="button" class="sort-btn" data-sort-key="max">Max &#8597;</button></th>
              <th class="num-col">Peak-to-Peak</th>
              <th class="num-col"><button type="button" class="sort-btn" data-sort-key="stdDev">Std Dev &#8597;</button></th>
            </tr>
          </thead>
          <tbody>${channelRows}</tbody>
        </table>
      </div>
    </section>
    ${historyHtml}
  `;
}

function renderSummaryTables() {
  const html = buildSummaryTablesHtml();
  els.overviewStatsContainer.innerHTML = html;
  els.statisticsTableContainer.innerHTML = html;
}

function renderBackendView() {
  const filters = ['All', 'ShortCircuit', 'Overcurrent', 'Overvoltage', 'Undervoltage', 'OpenCircuit', 'Healthy'];
  const filteredTaxonomy = state.taxonomy.filter((row) =>
    state.taxonomyFilter === 'All' ? true : row.mechanism === state.taxonomyFilter,
  );

  els.viewBackend.innerHTML = `
    <section class="panel">
      <div class="panel-header" style="margin-bottom:0;padding-bottom:16px;border-bottom:1px solid #223250;">
        <div>
          <h2 class="panel-title" style="font-size:18px;">Modular Inference Registry</h2>
          <p class="panel-subtitle" style="max-width:720px;line-height:1.5;margin-top:6px;">
            CSV parsing, electrical feature extraction, 60 Hz anomaly detection, symmetrical components, and 28-class inference are cleanly decoupled.
            Connect an external Python/PyTorch/ONNX ML service via <code class="inline-code">ML_SERVICE_URL</code> or run the included zero-dependency Java backend in <code class="inline-code">/java-backend/FaultAnalyzerServer.java</code>.
          </p>
        </div>
      </div>

      <div class="provider-grid">
        ${state.providers
          .map((p) => {
            const isSelected = p.id === state.selectedProviderId;
            return `
            <div class="provider-card ${isSelected ? 'active' : ''}">
              <div class="provider-top">
                <span class="provider-name">${esc(p.name)}</span>
                <span class="mono" style="font-size:12px;color:${p.available ? '#34D399' : '#94A3B8'};">
                  ${p.available ? 'Ready' : 'Awaiting ML_SERVICE_URL'}
                </span>
              </div>
              <p class="provider-desc">${esc(p.description)}</p>
              <div class="provider-foot">
                <span class="mono" style="font-size:12px;color:#64748B;">ID: ${esc(p.id)}</span>
                <button
                  type="button"
                  class="btn btn-sm ${isSelected ? 'btn-secondary' : 'btn-primary'}"
                  data-provider-id="${esc(p.id)}"
                  ${!p.available || isSelected ? 'disabled' : ''}
                >
                  ${isSelected ? 'Active Provider' : 'Use Provider'}
                </button>
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </section>

    <section class="panel-flush">
      <div class="panel-flush-header">
        <div>
          <h3 class="panel-title">Canonical 28-Class Fault Taxonomy (fault_type_table.m)</h3>
          <p class="panel-subtitle">
            1 Healthy &middot; 11 ShortCircuit (LG, LL, LLG, LLL, LLLG) &middot; 16 Non-Short-Circuit Per-Phase (Overcurrent, Overvoltage, Undervoltage, OpenCircuit)
          </p>
        </div>
        <div class="segmented-control">
          ${filters
            .map(
              (f) => `
            <button type="button" class="seg-btn ${state.taxonomyFilter === f ? 'active' : ''}" data-tax-filter="${f}">
              ${f}
            </button>`,
            )
            .join('')}
        </div>
      </div>

      <div class="table-wrap table-scroll-y">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>Mechanism</th>
              <th>Symmetry / Type</th>
              <th class="center-col">G</th>
              <th class="center-col">A</th>
              <th class="center-col">B</th>
              <th class="center-col">C</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${filteredTaxonomy
              .map((row, idx) => {
                const mechTone =
                  row.mechanism === 'ShortCircuit'
                    ? 'tone-amber'
                    : row.mechanism === 'Healthy'
                      ? 'tone-emerald'
                      : 'tone-purple';
                return `
                <tr>
                  <td class="mono tabular-nums" style="color:#64748B;">${idx + 1}</td>
                  <td class="mono" style="color:#F8FAFC;font-weight:600;">${esc(row.label)}</td>
                  <td class="mono ${mechTone}">${esc(row.mechanism)}</td>
                  <td>${esc(row.symmetry)}</td>
                  <td class="center-col" style="color:${row.G ? '#7DD3FC' : '#475569'};font-weight:${row.G ? 700 : 400};">${row.G}</td>
                  <td class="center-col" style="color:${row.A ? '#7DD3FC' : '#475569'};font-weight:${row.A ? 700 : 400};">${row.A}</td>
                  <td class="center-col" style="color:${row.B ? '#7DD3FC' : '#475569'};font-weight:${row.B ? 700 : 400};">${row.B}</td>
                  <td class="center-col" style="color:${row.C ? '#7DD3FC' : '#475569'};font-weight:${row.C ? 700 : 400};">${row.C}</td>
                  <td style="color:#94A3B8;">${esc(row.description)}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <div class="backend-code-grid">
      <section class="panel-flush">
        <div class="panel-flush-header">
          <div>
            <h3 class="panel-title">External ML Service Adapter (FastAPI)</h3>
            <p class="panel-subtitle">
              Return a 28-class <code class="inline-code">classProbabilities</code> dict + optional <code class="inline-code">anomalyScore</code>.
            </p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="copy-fastapi">Copy FastAPI</button>
        </div>
        <pre class="code-block"><code>${esc(FASTAPI_SNIPPET)}</code></pre>
      </section>

      <section class="panel-flush">
        <div class="panel-flush-header">
          <div>
            <h3 class="panel-title">Standalone Java 11+ Backend</h3>
            <p class="panel-subtitle">
              Zero-dependency JDK HttpServer in <code class="inline-code">/java-backend/FaultAnalyzerServer.java</code>.
            </p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="copy-java">Copy Java Cmd</button>
        </div>
        <pre class="code-block"><code>${esc(JAVA_RUN_SNIPPET)}</code></pre>
      </section>
    </div>
  `;
}

function renderAll() {
  renderHeaderMeta();
  renderUploadBar();
  renderSampleBar();
  renderModuleToggleBar();
  renderViewsVisibility();
  renderKpiStrip();
  renderTriagePipeline();
  renderExplainabilityPanel();
  renderBatchPanel();
  renderSummaryTables();
  renderBackendView();
  requestAnimationFrame(() => renderActiveCharts());
}

async function analyzeSample(sampleId) {
  try {
    setLoading(true);
    setError(null);
    state.activeSampleId = sampleId;
    const qs = state.selectedProviderId
      ? `?providerId=${encodeURIComponent(state.selectedProviderId)}`
      : '';
    const result = await apiJson(`/api/samples/${encodeURIComponent(sampleId)}/analyze${qs}`);
    pushAnalysis(result);
  } catch (err) {
    setError(err.message || 'Failed to analyze selected sample.');
  } finally {
    setLoading(false);
  }
}

async function analyzeFile(file) {
  if (
    !file.name.toLowerCase().endsWith('.csv') &&
    file.type &&
    !file.type.includes('csv') &&
    !file.type.includes('text')
  ) {
    setError('Please upload a valid .csv signal file containing numeric channel columns.');
    return;
  }

  try {
    setLoading(true);
    setError(null);
    state.activeSampleId = null;

    const formData = new FormData();
    formData.append('file', file);
    if (state.selectedProviderId) {
      formData.append('providerId', state.selectedProviderId);
    }

    const result = await apiJson('/api/analyze', {
      method: 'POST',
      body: formData,
    });
    pushAnalysis(result);
  } catch (err) {
    setError(err.message || 'Failed to parse or classify uploaded CSV.');
  } finally {
    setLoading(false);
  }
}

async function analyzeCompareSample(sampleId) {
  try {
    state.compareLoading = true;
    state.compareSampleId = sampleId;
    setError(null);
    if (state.activeTab === 'waveforms' && state.wfMode === 'compare') {
      renderSplitScreenComparison();
    }
    const qs = state.selectedProviderId
      ? `?providerId=${encodeURIComponent(state.selectedProviderId)}`
      : '';
    const result = await apiJson(`/api/samples/${encodeURIComponent(sampleId)}/analyze${qs}`);
    state.compareAnalysis = result;
    state.history = [result, ...state.history.filter((h) => h.id !== result.id)].slice(0, 12);
    renderSummaryTables();
  } catch (err) {
    setError(err.message || 'Failed to load Signal B sample for comparison.');
  } finally {
    state.compareLoading = false;
    requestAnimationFrame(() => renderActiveCharts());
  }
}

async function analyzeCompareFile(file) {
  if (
    !file.name.toLowerCase().endsWith('.csv') &&
    file.type &&
    !file.type.includes('csv') &&
    !file.type.includes('text')
  ) {
    setError('Please upload a valid .csv signal file for Signal B.');
    return;
  }

  try {
    state.compareLoading = true;
    state.compareSampleId = null;
    setError(null);
    if (state.activeTab === 'waveforms' && state.wfMode === 'compare') {
      renderSplitScreenComparison();
    }

    const formData = new FormData();
    formData.append('file', file);
    if (state.selectedProviderId) {
      formData.append('providerId', state.selectedProviderId);
    }

    const result = await apiJson('/api/analyze', {
      method: 'POST',
      body: formData,
    });
    state.compareAnalysis = result;
    state.history = [result, ...state.history.filter((h) => h.id !== result.id)].slice(0, 12);
    renderSummaryTables();
  } catch (err) {
    setError(err.message || 'Failed to parse or classify uploaded Signal B CSV.');
  } finally {
    state.compareLoading = false;
    requestAnimationFrame(() => renderActiveCharts());
  }
}

function ensureCompareSignalLoaded() {
  if (state.compareAnalysis || state.compareLoading || !state.samples.length) return;
  const preferred =
    state.activeSampleId === 'f1_LG_A'
      ? state.samples.find((s) => s.id === 'f2_LLG_BC')
      : state.samples.find((s) => s.id === 'f1_LG_A');
  const fallback =
    preferred || state.samples.find((s) => s.id !== state.activeSampleId) || state.samples[0];
  if (fallback) {
    analyzeCompareSample(fallback.id);
  }
}

async function runBuiltInBenchmark() {
  try {
    state.batchLoading = true;
    renderBatchPanel();
    const qs = state.selectedProviderId
      ? `?providerId=${encodeURIComponent(state.selectedProviderId)}`
      : '';
    state.batchResult = await apiJson(`/api/samples/batch-benchmark${qs}`);
  } catch (err) {
    setError(err.message || 'Batch benchmark failed.');
  } finally {
    state.batchLoading = false;
    renderBatchPanel();
  }
}

async function runBatchUpload(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  try {
    state.batchLoading = true;
    setError(null);
    renderBatchPanel();

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (state.selectedProviderId) {
      formData.append('providerId', state.selectedProviderId);
    }

    state.batchResult = await apiJson('/api/analyze/batch', {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    setError(err.message || 'Batch CSV evaluation failed.');
  } finally {
    state.batchLoading = false;
    renderBatchPanel();
  }
}

function exportJsonReport() {
  if (!state.analysis) return;
  const blob = new Blob([JSON.stringify(state.analysis, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.analysis.fileName.replace(/\.csv$/i, '')}_report.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  // Navigation tabs
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  els.brandHome.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('overview');
  });

  els.footerBackendBtn.addEventListener('click', () => switchTab('backend'));

  // File pickers & Print PDF
  const openPicker = () => els.fileInput.click();
  els.topbarUploadBtn.addEventListener('click', openPicker);
  els.browseFileBtn.addEventListener('click', openPicker);
  els.printPdfBtn.addEventListener('click', () => {
    if (state.activeTab !== 'overview') switchTab('overview');
    setTimeout(() => window.print(), 120);
  });

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) analyzeFile(file);
    e.target.value = '';
  });

  els.batchFileInput.addEventListener('change', (e) => {
    if (e.target.files?.length) {
      runBatchUpload(e.target.files);
    }
    e.target.value = '';
  });

  // Drag and drop CSV
  els.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropZone.classList.add('drag-over');
  });
  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('drag-over');
  });
  els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length > 1) {
      state.modules.batch = true;
      renderModuleToggleBar();
      runBatchUpload(files);
    } else if (files?.[0]) {
      analyzeFile(files[0]);
    }
  });

  // Diagnostic Module Toggles
  els.moduleToggleBar.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-mod-toggle]');
    if (toggleBtn) {
      const key = toggleBtn.dataset.modToggle;
      state.modules[key] = !state.modules[key];
      renderModuleToggleBar();
      renderExplainabilityPanel();
      renderBatchPanel();
      requestAnimationFrame(() => renderActiveCharts());
      return;
    }

    const bulkBtn = e.target.closest('[data-mod-bulk]');
    if (bulkBtn) {
      const enable = bulkBtn.dataset.modBulk === 'all';
      Object.keys(state.modules).forEach((k) => {
        state.modules[k] = enable;
      });
      renderModuleToggleBar();
      renderExplainabilityPanel();
      renderBatchPanel();
      requestAnimationFrame(() => renderActiveCharts());
    }
  });

  // Anomaly Threshold Calibration Slider
  els.thresholdSlider.addEventListener('input', () => {
    state.anomalyThreshold = Number(els.thresholdSlider.value);
    renderKpiStrip();
    renderTriagePipeline();
    renderActiveCharts();
  });

  els.thresholdReset.addEventListener('click', () => {
    state.anomalyThreshold = 25;
    els.thresholdSlider.value = '25';
    renderKpiStrip();
    renderTriagePipeline();
    renderActiveCharts();
  });

  // Phasor & FFT group toggles
  els.phasorGroupToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-phasor-group]');
    if (!btn) return;
    state.phasorGroup = btn.dataset.phasorGroup;
    renderAdvancedDiagnosticPanels();
  });

  els.fftGroupToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fft-group]');
    if (!btn) return;
    state.fftGroup = btn.dataset.fftGroup;
    renderAdvancedDiagnosticPanels();
  });

  // Batch evaluation controls
  els.moduleBatchPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'run-benchmark') {
      runBuiltInBenchmark();
    } else if (btn.dataset.action === 'upload-batch') {
      els.batchFileInput.click();
    }
  });

  // Error dismiss
  els.errorDismissBtn.addEventListener('click', () => setError(null));

  // Sample preset clicks
  els.sampleBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sample-id]');
    if (!btn || state.isLoading) return;
    analyzeSample(btn.dataset.sampleId);
  });

  // Triage interactive toggles
  els.triageColumn.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-anomaly-details') {
      state.showAnomalyDetails = !state.showAnomalyDetails;
      renderTriagePipeline();
      requestAnimationFrame(() => renderActiveCharts());
    } else if (btn.dataset.action === 'toggle-mechanisms') {
      state.showAllMechanisms = !state.showAllMechanisms;
      renderTriagePipeline();
      requestAnimationFrame(() => renderActiveCharts());
    } else if (btn.dataset.action === 'toggle-types') {
      state.showAllTypes = !state.showAllTypes;
      renderTriagePipeline();
      requestAnimationFrame(() => renderActiveCharts());
    }
  });

  // Waveform group toggle
  els.ovWaveGroupToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wave-group]');
    if (!btn) return;
    state.waveGroup = btn.dataset.waveGroup;
    renderActiveCharts();
  });

  // Channel visibility toggles (Overview, Waveforms, Split-Screen Compare, and Focused Modal)
  [
    els.ovChannelToggles,
    els.wfCurrentToggles,
    els.wfVoltageToggles,
    els.cmpAToggles,
    els.cmpBToggles,
    els.modalChannelToggles,
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-channel]');
      if (!btn) return;
      const ch = btn.dataset.channel;
      state.hiddenChannels[ch] = !state.hiddenChannels[ch];
      renderActiveCharts();
    });
  });

  // Waveforms Single vs Split-Screen Compare controls
  els.wfModeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wf-mode]');
    if (!btn) return;
    state.wfMode = btn.dataset.wfMode;
    if (state.wfMode === 'compare') {
      ensureCompareSignalLoaded();
    }
    requestAnimationFrame(() => renderActiveCharts());
  });

  els.cmpUploadABtn.addEventListener('click', () => els.fileInput.click());
  els.cmpUploadBBtn.addEventListener('click', () => els.compareFileInput.click());

  els.compareFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) analyzeCompareFile(file);
    e.target.value = '';
  });

  els.cmpSelectA.addEventListener('change', () => {
    const val = els.cmpSelectA.value;
    if (val.startsWith('sample:')) {
      analyzeSample(val.slice('sample:'.length));
    } else if (val.startsWith('history:')) {
      const id = val.slice('history:'.length);
      const match = state.history.find((h) => h.id === id);
      if (match) {
        state.analysis = match;
        const sampleMatch = state.samples.find((s) => s.fileName === match.fileName);
        state.activeSampleId = sampleMatch ? sampleMatch.id : null;
        renderAll();
      }
    }
  });

  els.cmpSelectB.addEventListener('change', () => {
    const val = els.cmpSelectB.value;
    if (val.startsWith('sample:')) {
      analyzeCompareSample(val.slice('sample:'.length));
    } else if (val.startsWith('history:')) {
      const id = val.slice('history:'.length);
      const match = state.history.find((h) => h.id === id);
      if (match) {
        state.compareAnalysis = match;
        const sampleMatch = state.samples.find((s) => s.fileName === match.fileName);
        state.compareSampleId = sampleMatch ? sampleMatch.id : null;
        requestAnimationFrame(() => renderActiveCharts());
      }
    }
  });

  els.cmpSwapBtn.addEventListener('click', () => {
    if (!state.analysis || !state.compareAnalysis) return;
    const prevA = state.analysis;
    const prevSampleA = state.activeSampleId;
    state.analysis = state.compareAnalysis;
    state.activeSampleId = state.compareSampleId;
    state.compareAnalysis = prevA;
    state.compareSampleId = prevSampleA;
    renderAll();
  });

  els.cmpWaveGroupToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmp-group]');
    if (!btn || btn.disabled) return;
    state.compareGroup = btn.dataset.cmpGroup;
    renderActiveCharts();
  });

  els.cmpLockYBtn.addEventListener('click', () => {
    state.compareLockY = !state.compareLockY;
    renderActiveCharts();
  });

  els.cmpZoomStart.addEventListener('input', () => {
    let s = Number(els.cmpZoomStart.value);
    if (s >= state.zoomEndPct - 2) s = Math.max(0, state.zoomEndPct - 2);
    setZoomRange(s, state.zoomEndPct);
  });

  els.cmpZoomEnd.addEventListener('input', () => {
    let end = Number(els.cmpZoomEnd.value);
    if (end <= state.zoomStartPct + 2) end = Math.min(100, state.zoomStartPct + 2);
    setZoomRange(state.zoomStartPct, end);
  });

  els.cmpZoomReset.addEventListener('click', () => setZoomRange(0, 100));

  els.cmpAFocusBtn.addEventListener('click', () =>
    openOscillogramModal(state.compareGroup, state.analysis),
  );
  els.cmpBFocusBtn.addEventListener('click', () => {
    if (state.compareAnalysis) {
      openOscillogramModal(state.compareGroup, state.compareAnalysis);
    }
  });

  // Expand / Zoom Focus Oscillogram Modal triggers
  els.ovExpandWaveBtn.addEventListener('click', () => openOscillogramModal(state.waveGroup));
  els.wfExpandCurrentBtn.addEventListener('click', () => openOscillogramModal('current'));
  els.wfExpandVoltageBtn.addEventListener('click', () => openOscillogramModal('voltage'));
  els.modalCloseBtn.addEventListener('click', closeOscillogramModal);
  els.oscModal.addEventListener('click', (e) => {
    if (e.target === els.oscModal) closeOscillogramModal();
  });

  els.modalWaveGroupToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modal-wave-group]');
    if (!btn) return;
    state.modalWaveGroup = btn.dataset.modalWaveGroup;
    state.waveGroup = btn.dataset.modalWaveGroup;
    renderActiveCharts();
  });

  els.modalZoomIn.addEventListener('click', () => zoomByFactor(0.55));
  els.modalZoomOut.addEventListener('click', () => zoomByFactor(1.8));
  els.modalPanLeft.addEventListener('click', () => panWindow(-1));
  els.modalPanRight.addEventListener('click', () => panWindow(1));
  els.modalFocusOnset.addEventListener('click', focusOnFaultOnset);
  els.modalZoomReset.addEventListener('click', () => setZoomRange(0, 100));

  els.modalZoomStart.addEventListener('input', () => {
    let s = Number(els.modalZoomStart.value);
    if (s >= state.zoomEndPct - 2) s = Math.max(0, state.zoomEndPct - 2);
    setZoomRange(s, state.zoomEndPct);
  });

  els.modalZoomEnd.addEventListener('input', () => {
    let end = Number(els.modalZoomEnd.value);
    if (end <= state.zoomStartPct + 2) end = Math.min(100, state.zoomStartPct + 2);
    setZoomRange(state.zoomStartPct, end);
  });

  document.addEventListener('keydown', (e) => {
    if (!state.oscModalOpen) return;
    if (e.key === 'Escape') {
      closeOscillogramModal();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomByFactor(0.55);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomByFactor(1.8);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      panWindow(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      panWindow(1);
    } else if (e.key === '0') {
      e.preventDefault();
      setZoomRange(0, 100);
    }
  });

  // Inline Zoom controls
  els.ovZoomStart.addEventListener('input', () => {
    let s = Number(els.ovZoomStart.value);
    if (s >= state.zoomEndPct - 5) {
      s = Math.max(0, state.zoomEndPct - 5);
    }
    setZoomRange(s, state.zoomEndPct);
  });

  els.ovZoomEnd.addEventListener('input', () => {
    let end = Number(els.ovZoomEnd.value);
    if (end <= state.zoomStartPct + 5) {
      end = Math.min(100, state.zoomStartPct + 5);
    }
    setZoomRange(state.zoomStartPct, end);
  });

  els.ovZoomReset.addEventListener('click', () => {
    setZoomRange(0, 100);
  });

  // Analytics tab switcher
  els.ovAnalyticsTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chart-tab]');
    if (!btn) return;
    state.analyticsTab = btn.dataset.chartTab;
    renderActiveCharts();
  });

  // Summary tables delegation
  [els.overviewStatsContainer, els.statisticsTableContainer].forEach((container) => {
    container.addEventListener('click', (e) => {
      const grpBtn = e.target.closest('[data-stats-group]');
      if (grpBtn) {
        state.statsGroupFilter = grpBtn.dataset.statsGroup;
        renderSummaryTables();
        return;
      }

      const sortBtn = e.target.closest('[data-sort-key]');
      if (sortBtn) {
        const key = sortBtn.dataset.sortKey;
        if (state.statsSortKey === key) {
          state.statsSortAsc = !state.statsSortAsc;
        } else {
          state.statsSortKey = key;
          state.statsSortAsc = key === 'channel';
        }
        renderSummaryTables();
        return;
      }

      const exportBtn = e.target.closest('[data-action="export-json"]');
      if (exportBtn) {
        exportJsonReport();
        return;
      }

      const histRow = e.target.closest('[data-history-id]');
      if (histRow) {
        const match = state.history.find((h) => h.id === histRow.dataset.historyId);
        if (match) {
          state.analysis = match;
          const sampleMatch = state.samples.find((s) => s.fileName === match.fileName);
          state.activeSampleId = sampleMatch ? sampleMatch.id : null;
          renderAll();
        }
      }
    });
  });

  // Backend view delegation
  els.viewBackend.addEventListener('click', async (e) => {
    const providerBtn = e.target.closest('[data-provider-id]');
    if (providerBtn && !providerBtn.disabled) {
      state.selectedProviderId = providerBtn.dataset.providerId;
      renderBackendView();
      if (state.activeSampleId) {
        await analyzeSample(state.activeSampleId);
      }
      return;
    }

    const taxBtn = e.target.closest('[data-tax-filter]');
    if (taxBtn) {
      state.taxonomyFilter = taxBtn.dataset.taxFilter;
      renderBackendView();
      return;
    }

    const copyBtn = e.target.closest('[data-action="copy-fastapi"], [data-action="copy-java"]');
    if (copyBtn) {
      const text =
        copyBtn.dataset.action === 'copy-fastapi' ? FASTAPI_SNIPPET : JAVA_RUN_SNIPPET;
      try {
        await navigator.clipboard.writeText(text);
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = orig;
        }, 1800);
      } catch {
        // Ignore clipboard restrictions
      }
    }
  });

  // Responsive canvas redraw on window resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderActiveCharts(), 80);
  });
}

async function bootstrap() {
  bindEvents();
  renderModuleToggleBar();
  try {
    setLoading(true);
    setError(null);
    const [samplesRes, modelsRes, taxonomyRes, initialAnalysis] = await Promise.all([
      apiJson('/api/samples'),
      apiJson('/api/models'),
      apiJson('/api/taxonomy'),
      apiJson('/api/samples/f1_LG_A/analyze'),
    ]);

    state.samples = samplesRes.samples || [];
    state.providers = modelsRes.providers || [];
    state.taxonomy = taxonomyRes.classes || [];
    state.selectedProviderId = initialAnalysis.inference.providerId;
    pushAnalysis(initialAnalysis);
  } catch (err) {
    setError(err.message || 'Unable to initialize Fault Analyzer Dashboard.');
  } finally {
    setLoading(false);
  }
}

bootstrap();
