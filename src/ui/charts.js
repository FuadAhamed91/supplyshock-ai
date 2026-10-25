// Tiny dependency-free SVG line chart for "orders overdue over time".

/**
 * @param {object} o
 * @param {{values: ArrayLike<number>, color: string, label: string, dash?: string, fill?: boolean}[]} o.series
 * @param {number} o.horizon     hours on the x axis
 * @param {[number, number]=} o.band  shaded disruption window
 * @param {number=} o.now        vertical "now" marker
 */
export function lineChart({ series, horizon, band, now, width = 352, height = 132 }) {
  const pad = { l: 26, r: 8, t: 10, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  let max = 1;
  for (const s of series) for (let i = 0; i < s.values.length; i++) max = Math.max(max, s.values[i]);
  max = Math.max(2, Math.ceil(max * 1.15));
  const x = (t) => pad.l + (t / horizon) * w;
  const y = (v) => pad.t + h - (v / max) * h;

  const parts = [];
  if (band) {
    parts.push(`<rect x="${x(band[0]).toFixed(1)}" y="${pad.t}" width="${Math.max(1, x(band[1]) - x(band[0])).toFixed(1)}" height="${h}" fill="#E5484D" opacity="0.07"/>`);
  }
  // y grid: 0 and max
  const ticks = [0, Math.round(max / 2), max];
  for (const v of ticks) {
    parts.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#E8ECF2" stroke-width="1"/>`);
    parts.push(`<text x="${pad.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#94A3B8">${v}</text>`);
  }
  // x axis: day labels
  for (let d = 0; d * 24 <= horizon; d++) {
    const xx = x(d * 24 + 12);
    if (d * 24 + 12 > horizon) break;
    parts.push(`<text x="${xx.toFixed(1)}" y="${height - 5}" text-anchor="middle" font-size="9.5" fill="#94A3B8">D${d + 1}</text>`);
    if (d > 0) parts.push(`<line x1="${x(d * 24).toFixed(1)}" x2="${x(d * 24).toFixed(1)}" y1="${pad.t + h}" y2="${pad.t + h + 3}" stroke="#CBD5E1"/>`);
  }
  for (const s of series) {
    const pts = [];
    for (let i = 0; i < s.values.length; i += 1) pts.push(`${x(i).toFixed(1)},${y(s.values[i]).toFixed(1)}`);
    if (s.fill) {
      parts.push(`<polygon points="${x(0).toFixed(1)},${y(0)} ${pts.join(' ')} ${x(s.values.length - 1).toFixed(1)},${y(0)}" fill="${s.color}" opacity="0.1"/>`);
    }
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`);
  }
  if (now !== undefined) {
    parts.push(`<line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="${pad.t}" y2="${pad.t + h}" stroke="#0F172A" stroke-width="1" stroke-dasharray="2 3"/>`);
    parts.push(`<text x="${(x(now) + 4).toFixed(1)}" y="${pad.t + 9}" font-size="9.5" fill="#334155" font-weight="600">now</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Overdue orders over time">${parts.join('')}</svg>`;
}
