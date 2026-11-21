/**
 * Pure Vanilla JavaScript high-DPI HTML5 Canvas charting module.
 * Supports:
 *  - Multi-channel 3-phase oscillograms with optional Explainability saliency heatbands
 *  - Sliding-window Anomaly Score area chart with live adjustable threshold
 *  - Grouped Pre-Fault vs Event RMS bar chart
 *  - Horizontal Mechanism & 28-Class Fault Type probability bars
 *  - 3-Phase Vector Phasor Diagram (polar coordinates)
 *  - FFT Harmonic Spectrum (60 Hz - 780 Hz) & THD bar chart
 */

export const SERIES_COLORS = {
  Ia: '#38BDF8',
  Ib: '#F59E0B',
  Ic: '#A855F7',
  Va: '#38BDF8',
  Vb: '#F59E0B',
  Vc: '#A855F7',
};

const FALLBACK_COLORS = ['#38BDF8', '#F59E0B', '#A855F7', '#34D399', '#FB7185', '#60A5FA'];

export function getSeriesColor(channel, index) {
  return SERIES_COLORS[channel] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(200, Math.floor(rect.width));
  const height = Math.max(150, Math.floor(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function positionTooltip(tooltipEl, canvasWidth, mouseX, mouseY) {
  tooltipEl.classList.remove('hidden');
  const tipWidth = tooltipEl.offsetWidth || 170;
  const left = mouseX + 14 + tipWidth > canvasWidth ? Math.max(8, mouseX - tipWidth - 14) : mouseX + 14;
  const top = Math.max(8, mouseY - 12);
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/**
 * Interactive 3-phase signal waveform line chart with optional temporal saliency heatband,
 * click-and-drag box zoom, cursor-centered scroll-wheel zoom, and double-click focus expand.
 */
export function renderWaveformChart(canvas, tooltipEl, opts) {
  const {
    rows,
    channels,
    hiddenMap,
    unit,
    onsetMs,
    zoomStartPct = 0,
    zoomEndPct = 100,
    saliencyPoints = null,
    enlarged = false,
    fixedYRange = null,
    onZoomRange = null,
    onRequestExpand = null,
  } = opts;
  if (!canvas || !rows || rows.length < 2) return;

  const clampedStart = Math.max(0, Math.min(98, zoomStartPct));
  const clampedEnd = Math.max(clampedStart + 2, Math.min(100, zoomEndPct));
  const startIdx = Math.floor((rows.length - 1) * (clampedStart / 100));
  const endIdx = Math.max(startIdx + 2, Math.ceil((rows.length - 1) * (clampedEnd / 100)));
  const slice = rows.slice(startIdx, endIdx + 1);
  const activeChannels = channels.filter((ch) => !hiddenMap[ch]);

  let dragStartRatio = null;
  let dragCurrentRatio = null;

  const draw = (hoverIndex = -1, selA = null, selB = null) => {
    const { ctx, width, height } = setupCanvas(canvas);
    const pad = enlarged
      ? { top: 20, right: 24, bottom: 36, left: 68 }
      : { top: 14, right: 18, bottom: 30, left: 58 };
    const plotW = Math.max(40, width - pad.left - pad.right);
    const plotH = Math.max(40, height - pad.top - pad.bottom);

    let minY = Infinity;
    let maxY = -Infinity;
    if (
      fixedYRange &&
      typeof fixedYRange.minY === 'number' &&
      typeof fixedYRange.maxY === 'number' &&
      Number.isFinite(fixedYRange.minY) &&
      Number.isFinite(fixedYRange.maxY)
    ) {
      minY = fixedYRange.minY;
      maxY = fixedYRange.maxY;
    } else {
      for (const row of slice) {
        for (const ch of activeChannels) {
          const v = row[ch];
          if (typeof v === 'number' && Number.isFinite(v)) {
            if (v < minY) minY = v;
            if (v > maxY) maxY = v;
          }
        }
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = -1;
      maxY = 1;
    }
    const spanY = Math.max(1e-4, maxY - minY);
    minY -= spanY * 0.08;
    maxY += spanY * 0.08;

    const minT = slice[0].time;
    const maxT = slice[slice.length - 1].time;
    const spanT = Math.max(1e-4, maxT - minT);

    const xOf = (t) => pad.left + ((t - minT) / spanT) * plotW;
    const yOf = (v) => pad.top + (1 - (v - minY) / (maxY - minY)) * plotH;

    // Optional Explainability Temporal Saliency heatband overlay
    if (Array.isArray(saliencyPoints) && saliencyPoints.length > 1) {
      for (let i = 0; i < saliencyPoints.length - 1; i += 1) {
        const p1 = saliencyPoints[i];
        const p2 = saliencyPoints[i + 1];
        if (p2.time < minT || p1.time > maxT || p1.weight < 0.12) continue;
        const x1 = Math.max(pad.left, xOf(p1.time));
        const x2 = Math.min(pad.left + plotW, xOf(p2.time));
        if (x2 <= x1) continue;
        const alpha = Math.min(0.28, p1.weight * 0.28);
        ctx.fillStyle = `rgba(245, 158, 11, ${alpha.toFixed(3)})`;
        ctx.fillRect(x1, pad.top, x2 - x1 + 0.5, plotH);
      }
    }

    // Horizontal gridlines & Y ticks
    ctx.font = enlarged ? '12px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yTicks = enlarged ? 8 : 5;
    for (let i = 0; i <= yTicks; i += 1) {
      const val = minY + ((maxY - minY) * i) / yTicks;
      const y = yOf(val);
      ctx.strokeStyle = '#1E2C45';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();

      ctx.fillStyle = '#94A3B8';
      ctx.fillText(formatTick(val), pad.left - 8, y);
    }

    // X ticks & vertical oscilloscope graticule lines
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xTicks = enlarged ? 10 : 6;
    const xDecimals = spanT < 8 ? 2 : spanT < 40 ? 1 : 0;
    for (let i = 0; i <= xTicks; i += 1) {
      const tVal = minT + (spanT * i) / xTicks;
      const x = xOf(tVal);
      if (enlarged) {
        ctx.strokeStyle = 'rgba(30, 44, 69, 0.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
      }
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${tVal.toFixed(xDecimals)}ms`, x, pad.top + plotH + 8);
    }
    ctx.setLineDash([]);

    // Unit label on Y axis
    ctx.save();
    ctx.translate(16, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748B';
    ctx.fillText(unit, 0, 0);
    ctx.restore();

    // Zero baseline
    if (minY < 0 && maxY > 0) {
      const y0 = yOf(0);
      ctx.strokeStyle = '#2B3E5E';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y0);
      ctx.lineTo(pad.left + plotW, y0);
      ctx.stroke();
    }

    // Fault onset vertical line
    if (typeof onsetMs === 'number' && onsetMs >= minT && onsetMs <= maxT) {
      const ox = xOf(onsetMs);
      ctx.strokeStyle = '#F43F5E';
      ctx.lineWidth = enlarged ? 1.8 : 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ox, pad.top);
      ctx.lineTo(ox, pad.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      if (enlarged) {
        ctx.fillStyle = '#FDA4AF';
        ctx.textAlign = ox > pad.left + plotW - 110 ? 'right' : 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`Onset ${onsetMs.toFixed(2)} ms`, ox + (ox > pad.left + plotW - 110 ? -6 : 6), pad.top + 4);
      }
    }

    // Draw series lines
    activeChannels.forEach((ch) => {
      const color = getSeriesColor(ch, channels.indexOf(ch));
      ctx.strokeStyle = color;
      ctx.lineWidth = enlarged ? 2.1 : 1.75;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i += 1) {
        const v = slice[i][ch];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const x = xOf(slice[i].time);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // Active drag-to-zoom selection band
    if (selA !== null && selB !== null && Math.abs(selB - selA) > 0.004) {
      const rMin = Math.min(selA, selB);
      const rMax = Math.max(selA, selB);
      const sx1 = pad.left + rMin * plotW;
      const sx2 = pad.left + rMax * plotW;
      const t1 = minT + rMin * spanT;
      const t2 = minT + rMax * spanT;

      ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.fillRect(sx1, pad.top, sx2 - sx1, plotH);

      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx1, pad.top);
      ctx.lineTo(sx1, pad.top + plotH);
      ctx.moveTo(sx2, pad.top);
      ctx.lineTo(sx2, pad.top + plotH);
      ctx.stroke();

      const badgeText = `${t1.toFixed(1)} → ${t2.toFixed(1)} ms (Δ ${(t2 - t1).toFixed(1)} ms)`;
      ctx.font = '11px "JetBrains Mono", monospace';
      const tw = ctx.measureText(badgeText).width + 14;
      const bx = Math.max(pad.left + 4, Math.min(pad.left + plotW - tw - 4, (sx1 + sx2) / 2 - tw / 2));
      const by = pad.top + 8;
      ctx.fillStyle = 'rgba(11, 17, 32, 0.94)';
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, tw, 22);
      ctx.strokeRect(bx, by, tw, 22);
      ctx.fillStyle = '#E0F2FE';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx + tw / 2, by + 11);
    }

    // Hover crosshair & markers (hidden during active drag box)
    if (selA === null && hoverIndex >= 0 && hoverIndex < slice.length) {
      const pt = slice[hoverIndex];
      const hx = xOf(pt.time);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();

      activeChannels.forEach((ch) => {
        const v = pt[ch];
        if (typeof v !== 'number') return;
        const color = getSeriesColor(ch, channels.indexOf(ch));
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(hx, yOf(v), enlarged ? 4.2 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    return { pad, plotW, width };
  };

  let layout = draw(-1);

  const ratioFromClientX = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    return {
      mx,
      ratio: Math.max(0, Math.min(1, (mx - layout.pad.left) / layout.plotW)),
    };
  };

  canvas.onmousedown = (e) => {
    if (!onZoomRange || e.button !== 0) return;
    e.preventDefault();
    const { ratio } = ratioFromClientX(e.clientX);
    dragStartRatio = ratio;
    dragCurrentRatio = ratio;
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const ratio = Math.max(0, Math.min(1, (mx - layout.pad.left) / layout.plotW));

    if (dragStartRatio !== null && onZoomRange) {
      dragCurrentRatio = ratio;
      layout = draw(-1, dragStartRatio, dragCurrentRatio);
      return;
    }

    const idx = Math.round(ratio * (slice.length - 1));
    layout = draw(idx);

    if (tooltipEl) {
      const pt = slice[idx];
      const rowsHtml = activeChannels
        .map((ch) => {
          const color = getSeriesColor(ch, channels.indexOf(ch));
          const val = typeof pt[ch] === 'number' ? pt[ch].toFixed(2) : '--';
          return `<div style="display:flex;justify-content:space-between;gap:14px;">
            <span style="color:${color};">${ch}</span>
            <span>${val} ${unit}</span>
          </div>`;
        })
        .join('');
      tooltipEl.innerHTML = `<div style="color:#94A3B8;margin-bottom:4px;">t = ${pt.time.toFixed(2)} ms</div>${rowsHtml}`;
      positionTooltip(tooltipEl, layout.width, mx, my);
    }
  };

  const commitDragZoom = () => {
    if (dragStartRatio === null || !onZoomRange) return;
    const a = dragStartRatio;
    const b = dragCurrentRatio ?? a;
    dragStartRatio = null;
    dragCurrentRatio = null;

    if (Math.abs(b - a) < 0.025) {
      draw(-1);
      return;
    }

    const rMin = Math.min(a, b);
    const rMax = Math.max(a, b);
    const spanPct = clampedEnd - clampedStart;
    const nextStart = clampedStart + rMin * spanPct;
    const nextEnd = clampedStart + rMax * spanPct;
    if (nextEnd - nextStart >= 1.5) {
      onZoomRange(nextStart, nextEnd);
    } else {
      draw(-1);
    }
  };

  canvas.onmouseup = commitDragZoom;

  canvas.onmouseleave = () => {
    if (dragStartRatio !== null) {
      commitDragZoom();
      return;
    }
    draw(-1);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };

  canvas.onwheel = onZoomRange
    ? (e) => {
        if (!enlarged && !e.ctrlKey && !e.shiftKey) return;
        e.preventDefault();
        const { ratio } = ratioFromClientX(e.clientX);
        const spanPct = clampedEnd - clampedStart;
        const factor = e.deltaY < 0 ? 0.72 : 1.38;
        const nextSpan = Math.max(2, Math.min(100, spanPct * factor));
        const anchorPct = clampedStart + ratio * spanPct;
        let nextStart = anchorPct - ratio * nextSpan;
        let nextEnd = nextStart + nextSpan;
        if (nextStart < 0) {
          nextEnd = Math.min(100, nextEnd - nextStart);
          nextStart = 0;
        }
        if (nextEnd > 100) {
          nextStart = Math.max(0, nextStart - (nextEnd - 100));
          nextEnd = 100;
        }
        onZoomRange(nextStart, nextEnd);
      }
    : null;

  canvas.ondblclick = onRequestExpand
    ? () => {
        onRequestExpand();
      }
    : null;
}

/**
 * Sliding-window Anomaly Score Area Chart with interactive live threshold support.
 */
export function renderAnomalyAreaChart(canvas, tooltipEl, analysis, customThreshold) {
  const points = analysis?.anomaly?.timeline || [];
  if (!canvas || points.length < 2) return;

  const threshold = typeof customThreshold === 'number' ? customThreshold : analysis.anomaly.threshold;
  const isAnomalous = analysis.anomaly.anomalyScore >= threshold;
  const isOod = analysis.anomaly.isOutOfDistribution && isAnomalous;
  const onsetMs = analysis.features.faultInceptionMs;
  const strokeColor = isOod ? '#FB923C' : isAnomalous ? '#F43F5E' : '#34D399';

  const draw = (hoverIndex = -1) => {
    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 14, right: 18, bottom: 28, left: 46 };
    const plotW = Math.max(40, width - pad.left - pad.right);
    const plotH = Math.max(40, height - pad.top - pad.bottom);

    const minT = points[0].time;
    const maxT = points[points.length - 1].time;
    const spanT = Math.max(1e-4, maxT - minT);

    const xOf = (t) => pad.left + ((t - minT) / spanT) * plotW;
    const yOf = (val) => pad.top + (1 - Math.max(0, Math.min(100, val)) / 100) * plotH;

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const val of [0, 25, 50, 75, 100]) {
      const y = yOf(val);
      ctx.strokeStyle = '#1E2C45';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(String(val), pad.left - 8, y);
    }
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 5; i += 1) {
      const tVal = minT + (spanT * i) / 5;
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${tVal.toFixed(0)}ms`, xOf(tVal), pad.top + plotH + 8);
    }

    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, `${strokeColor}55`);
    grad.addColorStop(1, `${strokeColor}05`);

    ctx.beginPath();
    ctx.moveTo(xOf(points[0].time), yOf(0));
    for (const pt of points) {
      ctx.lineTo(xOf(pt.time), yOf(pt.score));
    }
    ctx.lineTo(xOf(points[points.length - 1].time), yOf(0));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const x = xOf(pt.time);
      const y = yOf(pt.score);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Adjustable Threshold line
    const ty = yOf(threshold);
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, ty);
    ctx.lineTo(pad.left + plotW, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#FBBF24';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Threshold (${threshold.toFixed(0)})`, pad.left + plotW - 4, Math.max(pad.top + 12, ty - 4));

    if (typeof onsetMs === 'number' && onsetMs >= minT && onsetMs <= maxT) {
      const ox = xOf(onsetMs);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ox, pad.top);
      ctx.lineTo(ox, pad.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (hoverIndex >= 0 && hoverIndex < points.length) {
      const pt = points[hoverIndex];
      const hx = xOf(pt.time);
      const hy = yOf(pt.score);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();

      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    return { pad, plotW, width };
  };

  let layout = draw(-1);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const ratio = Math.max(0, Math.min(1, (mx - layout.pad.left) / layout.plotW));
    const idx = Math.round(ratio * (points.length - 1));
    layout = draw(idx);

    if (tooltipEl) {
      const pt = points[idx];
      const above = pt.score >= threshold ? 'Above Threshold' : 'Below Threshold';
      tooltipEl.innerHTML = `
        <div style="color:#94A3B8;margin-bottom:4px;">t = ${pt.time.toFixed(1)} ms (${above})</div>
        <div>Anomaly Score: <strong style="color:${strokeColor};">${pt.score.toFixed(1)} / 100</strong></div>
        <div>Recon Error: ${pt.reconstructionError.toFixed(1)}%</div>
      `;
      positionTooltip(tooltipEl, layout.width, mx, my);
    }
  };

  canvas.onmouseleave = () => {
    draw(-1);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };
}

/**
 * Grouped Vertical Bar Chart comparing Pre-Fault RMS vs Post-Inception RMS.
 */
export function renderRmsBarChart(canvas, tooltipEl, channels) {
  if (!canvas || !channels || channels.length === 0) return;

  const unit = channels[0].unit || '';
  const maxVal = Math.max(1, ...channels.flatMap((c) => [c.preFaultRms, c.faultRms])) * 1.12;

  const draw = (hoverGroup = -1) => {
    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 24, right: 18, bottom: 32, left: 56 };
    const plotW = Math.max(40, width - pad.left - pad.right);
    const plotH = Math.max(40, height - pad.top - pad.bottom);

    const yOf = (v) => pad.top + (1 - v / maxVal) * plotH;

    ctx.font = '11px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillRect(pad.left, 6, 10, 10);
    ctx.fillStyle = '#CBD5E1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Pre-Fault RMS', pad.left + 15, 11);

    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(pad.left + 115, 6, 10, 10);
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText('Post-Inception RMS', pad.left + 130, 11);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const val = (maxVal * i) / 4;
      const y = yOf(val);
      ctx.strokeStyle = '#1E2C45';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(formatTick(val), pad.left - 8, y);
    }
    ctx.setLineDash([]);

    const groupW = plotW / channels.length;
    const barW = Math.min(34, Math.max(12, groupW * 0.28));

    channels.forEach((ch, idx) => {
      const gx = pad.left + idx * groupW;
      const cx = gx + groupW / 2;

      if (idx === hoverGroup) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.07)';
        ctx.fillRect(gx + 4, pad.top, groupW - 8, plotH);
      }

      const preH = plotH - (yOf(ch.preFaultRms) - pad.top);
      const postH = plotH - (yOf(ch.faultRms) - pad.top);

      ctx.fillStyle = '#475569';
      ctx.fillRect(cx - barW - 3, yOf(ch.preFaultRms), barW, preH);

      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(cx + 3, yOf(ch.faultRms), barW, postH);

      ctx.fillStyle = '#CBD5E1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(ch.channel, cx, pad.top + plotH + 9);
    });

    return { pad, plotW, groupW, width };
  };

  let layout = draw(-1);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = Math.floor((mx - layout.pad.left) / layout.groupW);
    if (idx >= 0 && idx < channels.length) {
      layout = draw(idx);
      const ch = channels[idx];
      if (tooltipEl) {
        tooltipEl.innerHTML = `
          <div style="color:#94A3B8;margin-bottom:4px;">${ch.label}</div>
          <div>Pre-Fault RMS: <strong>${ch.preFaultRms.toFixed(2)} ${unit}</strong></div>
          <div>Event RMS: <strong style="color:#38BDF8;">${ch.faultRms.toFixed(2)} ${unit}</strong></div>
          <div>Ratio: ${ch.faultRatio.toFixed(2)}x</div>
        `;
        positionTooltip(tooltipEl, layout.width, mx, my);
      }
    } else {
      draw(-1);
      if (tooltipEl) tooltipEl.classList.add('hidden');
    }
  };

  canvas.onmouseleave = () => {
    draw(-1);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };
}

/**
 * Horizontal Ranked Probability Bar Chart.
 */
export function renderHorizontalProbChart(canvas, tooltipEl, items, primaryColor) {
  if (!canvas || !items || items.length === 0) return;

  const draw = (hoverIdx = -1) => {
    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 10, right: 48, bottom: 26, left: 132 };
    const plotW = Math.max(60, width - pad.left - pad.right);
    const plotH = Math.max(40, height - pad.top - pad.bottom);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const pct of [0, 25, 50, 75, 100]) {
      const x = pad.left + (pct / 100) * plotW;
      ctx.strokeStyle = '#1E2C45';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${pct}%`, x, pad.top + plotH + 7);
    }
    ctx.setLineDash([]);

    const rowH = plotH / items.length;
    const barH = Math.min(22, Math.max(10, rowH * 0.56));

    items.forEach((item, idx) => {
      const ry = pad.top + idx * rowH;
      const by = ry + (rowH - barH) / 2;

      if (idx === hoverIdx) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
        ctx.fillRect(pad.left, ry + 1, plotW, rowH - 2);
      }

      ctx.fillStyle = '#E2E8F0';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.code, pad.left - 10, ry + rowH / 2);

      ctx.fillStyle = '#1E2B42';
      ctx.fillRect(pad.left, by, plotW, barH);

      const fillW = Math.max(3, (item.probability / 100) * plotW);
      ctx.fillStyle = idx === 0 ? primaryColor : idx === 1 ? '#38BDF8' : '#475569';
      ctx.fillRect(pad.left, by, fillW, barH);

      ctx.fillStyle = '#CBD5E1';
      ctx.textAlign = 'left';
      ctx.fillText(`${item.probability.toFixed(1)}%`, pad.left + plotW + 8, ry + rowH / 2);
    });

    return { pad, rowH, width };
  };

  let layout = draw(-1);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = Math.floor((my - layout.pad.top) / layout.rowH);
    if (idx >= 0 && idx < items.length) {
      layout = draw(idx);
      const item = items[idx];
      if (tooltipEl) {
        tooltipEl.innerHTML = `
          <div style="color:#94A3B8;margin-bottom:4px;">${item.label}</div>
          <div>Probability: <strong style="color:${primaryColor};">${item.probability.toFixed(1)}%</strong></div>
        `;
        positionTooltip(tooltipEl, layout.width, mx, my);
      }
    } else {
      draw(-1);
      if (tooltipEl) tooltipEl.classList.add('hidden');
    }
  };

  canvas.onmouseleave = () => {
    draw(-1);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };
}

/**
 * Polar 3-Phase Vector Phasor Diagram (Ia/Ib/Ic or Va/Vb/Vc).
 */
export function renderPhasorDiagram(canvas, seqGroup) {
  if (!canvas || !seqGroup || !seqGroup.phasors || seqGroup.phasors.length === 0) return;

  const { ctx, width, height } = setupCanvas(canvas);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(46, Math.min(width, height) / 2 - 30);

  // Concentric polar rings
  ctx.strokeStyle = '#1F2F4C';
  ctx.lineWidth = 1;
  for (const frac of [0.33, 0.66, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Axes & degree labels
  ctx.strokeStyle = '#263858';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#64748B';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('0°', cx + radius + 5, cy);
  ctx.textAlign = 'right';
  ctx.fillText('180°', cx - radius - 5, cy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('+90°', cx, cy - radius - 5);
  ctx.textBaseline = 'top';
  ctx.fillText('-90°', cx, cy + radius + 5);

  const maxMag = Math.max(1e-4, ...seqGroup.phasors.map((p) => p.magnitude));

  seqGroup.phasors.forEach((p, idx) => {
    const color = getSeriesColor(p.channel, idx);
    const rad = (p.angleDeg * Math.PI) / 180;
    const len = Math.max(8, (p.magnitude / maxMag) * radius * 0.92);
    const ex = cx + Math.cos(rad) * len;
    const ey = cy - Math.sin(rad) * len;

    // Vector line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Arrowhead
    const headLen = 8;
    const angleScreen = Math.atan2(ey - cy, ex - cx);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(
      ex - headLen * Math.cos(angleScreen - Math.PI / 6),
      ey - headLen * Math.sin(angleScreen - Math.PI / 6),
    );
    ctx.lineTo(
      ex - headLen * Math.cos(angleScreen + Math.PI / 6),
      ey - headLen * Math.sin(angleScreen + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();

    // Channel tag near tip
    const lx = cx + Math.cos(rad) * Math.min(radius + 10, len + 14);
    const ly = cy - Math.sin(rad) * Math.min(radius + 10, len + 14);
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.channel, lx, ly);
  });

  // Center pivot dot
  ctx.fillStyle = '#CBD5E1';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * FFT Harmonic Spectrum Bar Chart (Orders H1 - H13, 60 Hz - 780 Hz).
 */
export function renderSpectrumChart(canvas, tooltipEl, harmonics, unit) {
  if (!canvas || !harmonics || harmonics.length === 0) return;

  const maxPct = Math.max(100, ...harmonics.map((h) => h.pctOfFundamental));

  const draw = (hoverIdx = -1) => {
    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 16, right: 16, bottom: 32, left: 48 };
    const plotW = Math.max(40, width - pad.left - pad.right);
    const plotH = Math.max(40, height - pad.top - pad.bottom);

    const yOf = (pct) => pad.top + (1 - Math.min(maxPct, pct) / maxPct) * plotH;

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const pct of [0, 25, 50, 75, 100]) {
      const y = yOf(pct);
      ctx.strokeStyle = '#1E2C45';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${pct}%`, pad.left - 8, y);
    }
    ctx.setLineDash([]);

    const stepW = plotW / harmonics.length;
    const barW = Math.min(26, Math.max(8, stepW * 0.56));

    harmonics.forEach((h, idx) => {
      const cx = pad.left + idx * stepW + stepW / 2;
      const topY = yOf(h.pctOfFundamental);
      const bh = Math.max(2, pad.top + plotH - topY);

      if (idx === hoverIdx) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.fillRect(pad.left + idx * stepW + 2, pad.top, stepW - 4, plotH);
      }

      ctx.fillStyle =
        h.order === 1 ? '#38BDF8' : h.pctOfFundamental >= 8 ? '#FB923C' : '#F59E0B';
      ctx.fillRect(cx - barW / 2, topY, barW, bh);

      ctx.fillStyle = '#94A3B8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`H${h.order}`, cx, pad.top + plotH + 8);
    });

    return { pad, stepW, width };
  };

  let layout = draw(-1);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = Math.floor((mx - layout.pad.left) / layout.stepW);
    if (idx >= 0 && idx < harmonics.length) {
      layout = draw(idx);
      const h = harmonics[idx];
      if (tooltipEl) {
        tooltipEl.innerHTML = `
          <div style="color:#94A3B8;margin-bottom:4px;">Order H${h.order} (${h.freqHz} Hz)</div>
          <div>Magnitude: <strong style="color:#38BDF8;">${h.magnitude.toFixed(2)} ${unit}</strong></div>
          <div>% of H1: <strong>${h.pctOfFundamental.toFixed(2)}%</strong></div>
        `;
        positionTooltip(tooltipEl, layout.width, mx, my);
      }
    } else {
      draw(-1);
      if (tooltipEl) tooltipEl.classList.add('hidden');
    }
  };

  canvas.onmouseleave = () => {
    draw(-1);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };
}
