import type { WaveformSample } from '../../shared/types/fault.ts';

export interface ParsedSignalData {
  headers: string[];
  canonicalColumns: string[];
  rows: WaveformSample[];
  rawRowCount: number;
  timeColumn: string | null;
}

const COLUMN_ALIAS_MAP: Record<string, string> = {
  t: 'time',
  time: 'time',
  time_s: 'time',
  time_ms: 'time',
  timestamp: 'time',
  sample: 'time',
  ia: 'Ia',
  i_a: 'Ia',
  current_a: 'Ia',
  phase_a_current: 'Ia',
  ib: 'Ib',
  i_b: 'Ib',
  current_b: 'Ib',
  phase_b_current: 'Ib',
  ic: 'Ic',
  i_c: 'Ic',
  current_c: 'Ic',
  phase_c_current: 'Ic',
  va: 'Va',
  v_a: 'Va',
  voltage_a: 'Va',
  phase_a_voltage: 'Va',
  vb: 'Vb',
  v_b: 'Vb',
  voltage_b: 'Vb',
  phase_b_voltage: 'Vb',
  vc: 'Vc',
  v_c: 'Vc',
  voltage_c: 'Vc',
  phase_c_voltage: 'Vc',
};

function normalizeHeader(raw: string): string {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '');
  const lower = cleaned.toLowerCase().replace(/[\s-]+/g, '_');
  return COLUMN_ALIAS_MAP[lower] ?? cleaned;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === ',' || ch === ';') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseSignalCsv(csvText: string): ParsedSignalData {
  const sanitized = csvText.replace(/^\uFEFF/, '').trim();
  if (!sanitized) {
    throw new Error('The uploaded CSV file is empty.');
  }

  const lines = sanitized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 3) {
    throw new Error('CSV file must include a header row and at least 2 signal samples.');
  }

  const firstTokens = splitCsvLine(lines[0]);
  const firstRowAllNumeric = firstTokens.every((tok) => tok !== '' && Number.isFinite(Number(tok)));

  let rawHeaders: string[];
  let startIndex: number;

  if (firstRowAllNumeric) {
    const defaultHeaders = ['time', 'Ia', 'Ib', 'Ic', 'Va', 'Vb', 'Vc'];
    rawHeaders = firstTokens.map((_, idx) => defaultHeaders[idx] ?? `Ch${idx + 1}`);
    startIndex = 0;
  } else {
    rawHeaders = firstTokens;
    startIndex = 1;
  }

  const canonicalHeaders = rawHeaders.map((h, idx) => {
    const normalized = normalizeHeader(h);
    return normalized || `Ch${idx + 1}`;
  });

  const timeColumnIndex = canonicalHeaders.findIndex((h) => h === 'time');
  const timeHeaderIsMs =
    timeColumnIndex >= 0 && rawHeaders[timeColumnIndex].toLowerCase().includes('ms');

  const rows: WaveformSample[] = [];

  for (let i = startIndex; i < lines.length; i += 1) {
    const tokens = splitCsvLine(lines[i]);
    if (tokens.length === 0) continue;

    const sample: WaveformSample = {
      time: 0,
    };

    let numericFound = false;
    for (let col = 0; col < canonicalHeaders.length; col += 1) {
      const key = canonicalHeaders[col];
      const rawVal = tokens[col];
      if (rawVal === undefined || rawVal === '') continue;
      const num = Number(rawVal);
      if (!Number.isFinite(num)) continue;

      numericFound = true;
      if (key === 'time') {
        sample.time = timeHeaderIsMs ? num : num;
      } else {
        sample[key] = num;
      }
    }

    if (!numericFound) continue;

    if (timeColumnIndex < 0) {
      // Assume 4 kHz default sample spacing (0.25 ms) if no time column exists
      sample.time = Number((rows.length * 0.25).toFixed(4));
    } else if (!timeHeaderIsMs) {
      // If time values look like seconds (max span < 2.5), convert to ms after loop
    }

    rows.push(sample);
  }

  if (rows.length < 2) {
    throw new Error('Unable to parse numeric time-series rows from the uploaded CSV.');
  }

  // Normalize seconds to milliseconds for consistent dashboard axis display
  if (timeColumnIndex >= 0 && !timeHeaderIsMs) {
    const span = Math.abs(rows[rows.length - 1].time - rows[0].time);
    if (span > 0 && span <= 10) {
      const origin = rows[0].time;
      for (const row of rows) {
        row.time = Number(((row.time - origin) * 1000).toFixed(4));
      }
    } else {
      const origin = rows[0].time;
      for (const row of rows) {
        row.time = Number((row.time - origin).toFixed(4));
      }
    }
  }

  const numericColumns = canonicalHeaders.filter((h) => h !== 'time');
  const presentColumns = numericColumns.filter((col) =>
    rows.some((r) => typeof r[col] === 'number' && Number.isFinite(r[col] as number)),
  );

  if (presentColumns.length === 0) {
    throw new Error('No valid numeric signal channels were found in the CSV file.');
  }

  return {
    headers: rawHeaders,
    canonicalColumns: presentColumns,
    rows,
    rawRowCount: rows.length,
    timeColumn: timeColumnIndex >= 0 ? rawHeaders[timeColumnIndex] : null,
  };
}

export function downsampleWaveform(
  rows: WaveformSample[],
  maxPoints = 320,
): WaveformSample[] {
  if (rows.length <= maxPoints) {
    return rows;
  }

  const step = (rows.length - 1) / (maxPoints - 1);
  const sampled: WaveformSample[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.min(rows.length - 1, Math.round(i * step));
    sampled.push(rows[idx]);
  }
  return sampled;
}
