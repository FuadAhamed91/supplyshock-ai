// Lucide icons (ISC licence) rendered as inline SVG strings.
import {
  Ship, Warehouse, Factory, Hospital, Stethoscope, Pill, House, PlugZap, Construction, Zap,
  Sparkles, Play, Pause, RotateCcw, Download, Copy, Check, Clock, Leaf, DollarSign, Route,
  Boxes, HeartPulse, TriangleAlert, CircleCheck, X, ArrowRight, ShieldCheck, Gauge, Truck,
  Activity, Printer, MousePointerClick, Info, Anchor, LocateFixed, ChevronDown, Timer, Package,
} from 'lucide';

const ICONS = {
  Ship, Warehouse, Factory, Hospital, Stethoscope, Pill, House, PlugZap, Construction, Zap,
  Sparkles, Play, Pause, RotateCcw, Download, Copy, Check, Clock, Leaf, DollarSign, Route,
  Boxes, HeartPulse, TriangleAlert, CircleCheck, X, ArrowRight, ShieldCheck, Gauge, Truck,
  Activity, Printer, MousePointerClick, Info, Anchor, LocateFixed, ChevronDown, Timer, Package,
};

const esc = (v) => String(v).replace(/"/g, '&quot;');

export function icon(name, size = 16, stroke = 2) {
  const node = ICONS[name];
  if (!node) return '';
  const inner = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const SITE_ICON = {
  port: 'Ship', hub: 'Warehouse', supplier: 'Factory', hospital: 'Hospital',
  clinic: 'Stethoscope', pharmacy: 'Pill', carehome: 'House',
};
