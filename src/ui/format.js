export const int = (n) => Math.round(n).toLocaleString('en-US');

export function money(n) {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `$${Math.round(v / 1e3)}k`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${v}`;
}

export const pct = (x) => `${Math.round(x * 100)}%`;

export function days(hours) {
  if (hours <= 0.05) return '0 days';
  const d = hours / 24;
  if (d < 1) return `${Math.max(1, Math.round(hours))} h`;
  return `${d.toFixed(1)} days`;
}

export function co2(kg) {
  if (kg < 50) return '≈0 t';
  return `${(kg / 1000).toFixed(1)} t`;
}

export const oneDecimal = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
