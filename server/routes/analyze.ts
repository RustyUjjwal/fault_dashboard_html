import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import {
  FAULT_TYPE_CATALOG,
  type BatchEvalResponse,
  type BatchEvalRow,
  type FaultAnalysisResponse,
  type FaultTaxonomyEntry,
} from '../../shared/types/fault.ts';
import type { ModelRegistry } from '../models/inferenceProvider.ts';
import { evaluateSignalAnomalies } from '../services/anomalyDetector.ts';
import { downsampleWaveform, parseSignalCsv } from '../services/csvParser.ts';
import { extractSignalFeatures } from '../services/featureExtractor.ts';
import {
  generateSampleCsv,
  getSampleScenarioById,
  listSampleScenarios,
} from '../services/sampleGenerator.ts';
import {
  buildExplainabilityReport,
  computeSignalDiagnostics,
} from '../services/signalDiagnostics.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB per CSV
  },
});

async function runAnalysisPipeline(
  registry: ModelRegistry,
  csvText: string,
  fileName: string,
  fileSizeBytes: number,
  providerId?: string,
): Promise<FaultAnalysisResponse> {
  const startMs = performance.now();
  const parsed = parseSignalCsv(csvText);
  const features = extractSignalFeatures(parsed, fileName);
  const waveform = downsampleWaveform(parsed.rows, 320);

  const provider = registry.resolve(providerId);
  const prediction = await provider.predict({
    fileName,
    features,
    waveform,
  });

  // Compute model-agnostic 60 Hz waveform reconstruction & OOD anomaly report
  const evaluated = evaluateSignalAnomalies(
    parsed.rows,
    features,
    prediction.mechanism,
    prediction.faultType,
  );
  const anomaly = prediction.anomaly ?? {
    ...evaluated.report,
    ...(typeof prediction.anomalyScoreOverride === 'number'
      ? {
          anomalyScore: Math.round(prediction.anomalyScoreOverride * 10) / 10,
          isAnomalous: prediction.anomalyScoreOverride >= evaluated.report.threshold,
        }
      : {}),
  };

  // Promote Step 1 detection verdict when an Out-of-Distribution / unknown disturbance is flagged
  const detection = { ...prediction.detection };
  if (anomaly.isOutOfDistribution) {
    detection.faultDetected = true;
    detection.statusLabel = 'UNKNOWN ANOMALY';
    detection.confidence = Math.max(
      detection.confidence,
      Math.min(99.2, Math.round((70 + anomaly.anomalyScore * 0.28) * 10) / 10),
    );
    detection.severity = anomaly.anomalyScore >= 55 ? 'critical' : 'moderate';
  }

  // Compute Fortescue Symmetrical Components (I1/I2/I0, V1/V2/V0), FFT Harmonic Spectrum & THD, and Explainability
  const diagnostics = computeSignalDiagnostics(parsed.rows, features);
  const explainability = buildExplainabilityReport(
    features,
    diagnostics,
    anomaly,
    prediction.mechanism,
    prediction.faultType,
  );

  const elapsedMs = Math.max(0.4, Math.round((performance.now() - startMs) * 10) / 10);

  return {
    id: randomUUID(),
    fileName,
    fileSizeBytes,
    detection,
    anomaly,
    mechanism: prediction.mechanism,
    faultType: prediction.faultType,
    features,
    diagnostics,
    explainability,
    waveform,
    inference: {
      providerId: provider.id,
      providerName: provider.name,
      inferenceTimeMs: elapsedMs,
      analyzedAt: new Date().toISOString(),
    },
  };
}

/**
 * Infers ground-truth canonical fault label from filename (e.g., f1_LG_A.csv, Overcurrent_ABC_run3.csv).
 * Matches longest canonical labels first so LLLG matches before LLL and LLG_AB before LG_A.
 */
const SORTED_TAXONOMY_FOR_MATCHING: FaultTaxonomyEntry[] = [...FAULT_TYPE_CATALOG].sort(
  (a, b) => b.label.length - a.label.length,
);

function inferGroundTruthFromFileName(fileName: string): FaultTaxonomyEntry | null {
  const lower = fileName.toLowerCase();
  for (const entry of SORTED_TAXONOMY_FOR_MATCHING) {
    const token = entry.label.toLowerCase();
    const regex = new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i');
    if (regex.test(lower)) {
      return entry;
    }
  }
  return null;
}

function summarizeBatchEvaluation(rows: BatchEvalRow[]): BatchEvalResponse {
  const labeled = rows.filter((r) => r.trueLabel !== null);
  const labeledFiles = labeled.length;

  let accuracyPct: number | null = null;
  let mechanismAccuracyPct: number | null = null;
  let macroF1Pct: number | null = null;
  const labelSet = new Set<string>();

  for (const r of labeled) {
    if (r.trueLabel) labelSet.add(r.trueLabel);
    labelSet.add(r.predictedLabel);
  }
  const confusionLabels = Array.from(labelSet);
  const idxMap = new Map<string, number>();
  confusionLabels.forEach((lbl, i) => idxMap.set(lbl, i));

  const confusionMatrix = confusionLabels.map(() => confusionLabels.map(() => 0));

  if (labeledFiles > 0) {
    const exactCorrect = labeled.filter((r) => r.correct === true).length;
    const mechCorrect = labeled.filter((r) => r.mechanismCorrect === true).length;
    accuracyPct = Math.round((exactCorrect / labeledFiles) * 1000) / 10;
    mechanismAccuracyPct = Math.round((mechCorrect / labeledFiles) * 1000) / 10;

    for (const r of labeled) {
      const ti = idxMap.get(r.trueLabel!);
      const pi = idxMap.get(r.predictedLabel);
      if (ti !== undefined && pi !== undefined) {
        confusionMatrix[ti][pi] += 1;
      }
    }

    // Macro-F1 across all classes present in ground truth
    const trueClasses = Array.from(new Set(labeled.map((r) => r.trueLabel!)));
    let f1Sum = 0;
    for (const cls of trueClasses) {
      const ci = idxMap.get(cls)!;
      const tp = confusionMatrix[ci][ci];
      let fp = 0;
      let fn = 0;
      for (let k = 0; k < confusionLabels.length; k += 1) {
        if (k !== ci) {
          fp += confusionMatrix[k][ci];
          fn += confusionMatrix[ci][k];
        }
      }
      const denom = 2 * tp + fp + fn;
      f1Sum += denom > 0 ? (2 * tp) / denom : 0;
    }
    macroF1Pct = Math.round((f1Sum / Math.max(1, trueClasses.length)) * 1000) / 10;
  }

  return {
    totalFiles: rows.length,
    labeledFiles,
    accuracyPct,
    mechanismAccuracyPct,
    macroF1Pct,
    confusionLabels,
    confusionMatrix,
    rows,
  };
}

export function createAnalyzeRouter(registry: ModelRegistry): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      providers: registry.list(),
      taxonomyCount: FAULT_TYPE_CATALOG.length,
    });
  });

  router.get('/taxonomy', (_req, res) => {
    res.json({
      totalClasses: FAULT_TYPE_CATALOG.length,
      classes: FAULT_TYPE_CATALOG,
    });
  });

  router.get('/models', (_req, res) => {
    res.json({
      providers: registry.list(),
    });
  });

  router.get('/samples', (_req, res) => {
    res.json({
      samples: listSampleScenarios(),
    });
  });

  router.get('/samples/batch-benchmark', async (req, res) => {
    try {
      const providerId =
        typeof req.query.providerId === 'string' ? req.query.providerId : undefined;
      const canonicalSamples = listSampleScenarios().filter((s) => s.mechanism !== 'Unknown');
      const rows: BatchEvalRow[] = [];

      for (const sample of canonicalSamples) {
        const { fileName, csv } = generateSampleCsv(sample.id);
        const result = await runAnalysisPipeline(
          registry,
          csv,
          fileName,
          Buffer.byteLength(csv, 'utf8'),
          providerId,
        );
        const trueLabel = sample.faultLabel;
        const trueMechanism = sample.mechanism;
        rows.push({
          fileName,
          trueLabel,
          trueMechanism,
          predictedLabel: result.faultType.topLabel,
          predictedMechanism: result.mechanism.topMechanism,
          confidence: result.faultType.topProbability,
          anomalyScore: result.anomaly.anomalyScore,
          isOod: result.anomaly.isOutOfDistribution,
          correct: result.faultType.topLabel === trueLabel,
          mechanismCorrect: result.mechanism.topMechanism === trueMechanism,
        });
      }

      res.json(summarizeBatchEvaluation(rows));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run batch benchmark.';
      res.status(500).json({ error: message });
    }
  });

  router.get('/samples/:id/analyze', async (req, res) => {
    try {
      const scenario = getSampleScenarioById(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: `Sample scenario "${req.params.id}" not found.` });
        return;
      }

      const providerId =
        typeof req.query.providerId === 'string' ? req.query.providerId : undefined;
      const { fileName, csv } = generateSampleCsv(scenario.id);
      const result = await runAnalysisPipeline(
        registry,
        csv,
        fileName,
        Buffer.byteLength(csv, 'utf8'),
        providerId,
      );

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze sample signal.';
      res.status(500).json({ error: message });
    }
  });

  router.get('/samples/:id/csv', (req, res) => {
    try {
      const scenario = getSampleScenarioById(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: `Sample scenario "${req.params.id}" not found.` });
        return;
      }

      const { fileName, csv } = generateSampleCsv(scenario.id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(csv);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate CSV file.';
      res.status(500).json({ error: message });
    }
  });

  router.post('/analyze', upload.single('file'), async (req, res) => {
    try {
      let csvText = '';
      let fileName = 'uploaded_signal.csv';
      let fileSizeBytes = 0;
      let providerId: string | undefined;

      if (req.file) {
        csvText = req.file.buffer.toString('utf8');
        fileName = req.file.originalname || fileName;
        fileSizeBytes = req.file.size;
        if (typeof req.body?.providerId === 'string' && req.body.providerId) {
          providerId = req.body.providerId;
        }
      } else if (req.body && typeof req.body.csvContent === 'string') {
        csvText = req.body.csvContent;
        fileName =
          typeof req.body.fileName === 'string' && req.body.fileName.trim()
            ? req.body.fileName.trim()
            : fileName;
        fileSizeBytes = Buffer.byteLength(csvText, 'utf8');
        if (typeof req.body.providerId === 'string' && req.body.providerId) {
          providerId = req.body.providerId;
        }
      } else {
        res.status(400).json({
          error: 'No CSV file provided. Upload a multipart file under field "file" or JSON { csvContent, fileName }.',
        });
        return;
      }

      const result = await runAnalysisPipeline(
        registry,
        csvText,
        fileName,
        fileSizeBytes,
        providerId,
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze CSV signal.';
      res.status(400).json({ error: message });
    }
  });

  router.post('/analyze/batch', upload.array('files', 50), async (req, res) => {
    try {
      const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Upload one or more CSV files under field "files".' });
        return;
      }

      const providerId =
        typeof req.body?.providerId === 'string' && req.body.providerId
          ? req.body.providerId
          : undefined;

      const rows: BatchEvalRow[] = [];
      for (const file of uploadedFiles) {
        const csvText = file.buffer.toString('utf8');
        const result = await runAnalysisPipeline(
          registry,
          csvText,
          file.originalname,
          file.size,
          providerId,
        );
        const groundTruth = inferGroundTruthFromFileName(file.originalname);
        rows.push({
          fileName: file.originalname,
          trueLabel: groundTruth?.label ?? null,
          trueMechanism: groundTruth?.mechanism ?? null,
          predictedLabel: result.faultType.topLabel,
          predictedMechanism: result.mechanism.topMechanism,
          confidence: result.faultType.topProbability,
          anomalyScore: result.anomaly.anomalyScore,
          isOod: result.anomaly.isOutOfDistribution,
          correct: groundTruth ? result.faultType.topLabel === groundTruth.label : null,
          mechanismCorrect: groundTruth
            ? result.mechanism.topMechanism === groundTruth.mechanism
            : null,
        });
      }

      res.json(summarizeBatchEvaluation(rows));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch CSV evaluation failed.';
      res.status(400).json({ error: message });
    }
  });

  return router;
}
