// Generates composition/index.html from the measured narration.
//
// Every cut, subtitle and callout is placed from the real sentence durations
// of the generated voiceover, so nothing here is a hand-typed timestamp that
// can drift from the audio. Run: node scripts/gen.mjs   (then: cd composition && npx hyperframes check)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // brag-output/
const VO_PARTS = path.join(HERE, 'vo/parts');
const OUT = path.join(HERE, 'composition/index.html');

const TOTAL = 150;
const LEAD_IN = 1.0;        // silence before the first word
const TITLE_BEAT = 2.2;     // the pause after the hook, held for the title card
const GAP = 0.22;           // breath between sentences (matches vo-build)
const PRE_CUT = 0.45;       // picture lands this long before the voice
const XFADE = 0.5;          // longest crossfade between scenes
const SUB_CHARS = 48;       // one subtitle line

const SCENES = [
  { id: 's1', file: 's1-cold-open.mp4', footage: 13 },
  { id: 's2', file: 's2-normal-week.mp4', footage: 18, chapter: '01 · The network' },
  { id: 's3', file: 's3-break-a-link.mp4', footage: 20, chapter: '02 · Break a link', mediaStart: 0.8 },
  { id: 's4', file: 's4-the-ripple.mp4', footage: 25, chapter: '03 · The ripple' },
  { id: 's5', file: 's5-the-planner.mp4', footage: 30, chapter: '04 · The AI planner' },
  { id: 's6', file: 's6-the-plan.mp4', footage: 26, chapter: '05 · The plan' },
  { id: 's7', file: 's7-recovery.mp4', footage: 20, chapter: '06 · The recovery' },
  { id: 's8', file: 's8-close.mp4', footage: 12 },
];

// What the viewer reads. The narration spells numbers out so Kokoro says them
// right; subtitles show them the way the screen does. One entry per spoken
// sentence, in order.
const DISPLAY = {
  s1: [
    'A ship stuck outside a port on Monday can leave a hospital without insulin by Wednesday.',
    'The chain between those two facts is invisible, until it breaks.',
  ],
  s2: [
    'Large distributors run planning suites that model this.',
    'Everyone else finds out when a customer calls about a delivery that never arrived.',
    'This is a regional medical-supply network, running an ordinary week.',
  ],
  s3: [
    'So break one link.',
    'Close the port, shut a hub, close a bridge, or cut a supplier.',
    'Choose how long it lasts, and watch it hit.',
    'The clock stops, the shock spreads out from the terminal, and every route that depended on it turns red.',
  ],
  s4: [
    'Then it tells you what doing nothing costs.',
    '22 orders late, out of 70.',
    '11 of them for hospitals.',
    '5 days to recover.',
    '$64,000.',
    'And it names the casualties in order.',
    'Day 2: Central Hub runs out of insulin.',
    'Day 3: St. Clara Hospital gets a late order.',
  ],
  s5: [
    'Now the planner goes to work.',
    'This is not a chatbot.',
    'It is a simulation-based planning agent.',
    'It takes every combination of 4 recovery levers, and plays each one out across 40 randomised futures, where demand, travel times, and the disruption’s real length all vary.',
    'Green means every hospital order arrived on time.',
    '328 simulations, in under a second, in your browser.',
    'Slowed down here, so you can watch it think.',
  ],
  s6: [
    'Then it picks one, and it shows its work.',
    '22 late orders become 3.',
    '11 late hospital orders become none.',
    '$64,000 becomes $28,000.',
    'And here is the part that matters.',
    'Another plan had zero late orders in the expected week, better than the one it chose.',
    'It rejected it anyway, because in 19 of 40 futures, a hospital waits.',
  ],
  s7: [
    'Apply it, and the week replays from the moment the disruption hit.',
    'Green is the plan in action.',
    'Rush orders and spare stock, moving to where they’re needed.',
    'The hubs hold, the hospitals stay on schedule, and it keeps score against doing nothing, hour by hour.',
  ],
  s8: [
    'No server.',
    'No API keys.',
    'One browser tab, and an answer to the only question that matters.',
    'When one link breaks, who runs out first?',
  ],
};

// When things happen inside each captured clip (seconds into the source file),
// from the capture script.
const IN_CLIP = {
  s3: { trigger: 9.0 },
  s5: { fillStart: 1.5, fillEnd: 27.0 },
};

const probe = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- narration
for (const s of SCENES) {
  const parts = fs.readdirSync(VO_PARTS).filter((f) => f.startsWith(`${s.id}-`) && f.endsWith('-trim.wav')).sort();
  if (parts.length !== DISPLAY[s.id].length) throw new Error(`${s.id}: ${parts.length} spoken sentences vs ${DISPLAY[s.id].length} display sentences`);
  s.sentences = [];
  let t = 0;
  parts.forEach((p, i) => {
    const dur = probe(path.join(VO_PARTS, p));
    s.sentences.push({ start: t, dur, text: DISPLAY[s.id][i] });
    t += dur + GAP;
  });
  s.vo = t - GAP;
}

// ----------------------------------------------------------------- timeline
const voTotal = SCENES.reduce((a, s) => a + s.vo, 0);
const tail = 1.8;
const between = (TOTAL - LEAD_IN - voTotal - TITLE_BEAT - tail) / (SCENES.length - 2);
if (between < 0.35) throw new Error(`narration too long: ${voTotal.toFixed(2)}s leaves ${between.toFixed(2)}s between scenes`);

let t = LEAD_IN;
SCENES.forEach((s, k) => {
  s.voStart = t;
  t += s.vo + (k === 0 ? TITLE_BEAT : between);
});

// Cuts land just before each line. Where a scene would outrun its footage, the
// cut slides later (a J-cut: the voice leads into the picture).
SCENES.forEach((s, k) => { s.cut = k === 0 ? 0 : s.voStart - PRE_CUT; });
for (let pass = 0; pass < 4; pass++) {
  SCENES.forEach((s, k) => {
    const end = k === SCENES.length - 1 ? TOTAL : SCENES[k + 1].cut;
    const avail = s.footage - (s.mediaStart || 0);
    if (end - s.cut > avail) {
      if (k < SCENES.length - 1) SCENES[k + 1].cut = s.cut + avail; // next scene cuts in earlier
      else s.cut = TOTAL - avail;                                    // last scene starts later
    }
  });
  SCENES.forEach((s, k) => {
    if (k === 0) return;
    const prev = SCENES[k - 1];
    const prevAvail = prev.footage - (prev.mediaStart || 0);
    if (s.cut - prev.cut > prevAvail) s.cut = prev.cut + prevAvail;
  });
}
SCENES.forEach((s, k) => {
  s.end = k === SCENES.length - 1 ? TOTAL : SCENES[k + 1].cut;
  s.dur = s.end - s.cut;
  const avail = s.footage - (s.mediaStart || 0);
  if (s.dur > avail + 1e-6) throw new Error(`${s.id} needs ${s.dur.toFixed(2)}s of footage, has ${avail}`);
  // Crossfade: the outgoing shot plays on and dissolves over the incoming one.
  s.fade = k === SCENES.length - 1 ? 0 : Math.min(XFADE, avail - s.dur);
  if (s.fade < 0.15) s.fade = 0;
});

// ---------------------------------------------------------------- subtitles
/** Split a sentence into lines of balanced length (no one-word orphans). */
function balance(text) {
  const words = text.split(/\s+/);
  const n = Math.max(1, Math.ceil(text.length / SUB_CHARS));
  if (n === 1) return [text];
  const target = text.length / n;
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length > target && lines.length < n - 1) { lines.push(cur); cur = w; } else cur = next;
  }
  lines.push(cur);
  return lines;
}

const subs = [];
let hideSubsFrom = Infinity;
for (const s of SCENES) {
  s.sentences.forEach((sen, i) => {
    const abs = s.voStart + sen.start;
    // The closing question is set as the end card itself, not as a subtitle.
    if (s.id === 's8' && i === s.sentences.length - 1) { hideSubsFrom = abs; return; }
    const lines = balance(sen.text);
    const blocks = [];
    for (let j = 0; j < lines.length; j += 2) blocks.push(lines.slice(j, j + 2));
    const chars = lines.reduce((a, l) => a + l.length, 0);
    let st = abs;
    blocks.forEach((b) => {
      const d = sen.dur * (b.reduce((a, l) => a + l.length, 0) / chars);
      subs.push({ start: st, end: st + d, lines: b });
      st += d;
    });
  });
}
// Bridge the short breaths between sentences so a subtitle never blinks off and on.
subs.forEach((c, i) => {
  const next = subs[i + 1];
  if (next && next.start - c.end < 0.45) c.end = next.start;
  c.end = Math.min(c.end + 0.15, next ? next.start : c.end + 0.15);
  if (c.end - c.start < 0.9 && !(next && next.start - c.start < 0.9)) c.end = c.start + 0.9;
});

// ------------------------------------------------------------------ anchors
const S = Object.fromEntries(SCENES.map((s) => [s.id, s]));
const at = (id, i) => S[id].voStart + S[id].sentences[i].start;
const A = {
  titleIn: at('s1', 1) + S.s1.sentences[1].dur - 0.55,              // lands on "...until it breaks."
  trigger: S.s3.cut + IN_CLIP.s3.trigger - (S.s3.mediaStart || 0),
  replayFrom: S.s5.cut + 4.2,
  replayTo: S.s5.cut + IN_CLIP.s5.fillEnd,
  gridDone: S.s5.cut + IN_CLIP.s5.fillEnd,
  simsIn: at('s5', 5),
  rivalIn: at('s6', 5),
  rejectIn: at('s6', 6),
  applyAt: S.s7.cut + 0.05,
  saferIn: at('s7', 3),
  endIn: at('s8', 2),
  questionIn: at('s8', 3),
};

// --------------------------------------------------------------------- html
const fx = (n) => r3(n).toString();
const videos = SCENES.map((s, k) => `
      <div class="vwrap" id="vw-${s.id}" style="z-index:${20 - k}">
        <video id="v-${s.id}" class="clip" src="assets/footage/${s.file}" data-start="${fx(s.cut)}" data-duration="${fx(s.dur + s.fade)}"${s.mediaStart ? ` data-media-start="${s.mediaStart}"` : ''} data-track-index="${k % 2}" muted playsinline></video>
      </div>`).join('');

const voice = SCENES.map((s) => `
      <audio id="vo-${s.id}" src="assets/vo/${s.id}.wav" data-start="${fx(s.voStart)}" data-duration="${fx(s.vo)}" data-track-index="10" data-volume="1"></audio>`).join('');

const sfx = `
      <audio id="sfx-trigger" src="assets/sfx/impactSoft_heavy_001.ogg" data-start="${fx(A.trigger - 0.03)}" data-duration="0.57" data-track-index="11" data-volume="0.5"></audio>
      <audio id="sfx-grid" src="assets/sfx/bong_001.ogg" data-start="${fx(A.gridDone)}" data-duration="0.12" data-track-index="12" data-volume="0.32"></audio>
      <audio id="sfx-apply" src="assets/sfx/impactSoft_medium_001.ogg" data-start="${fx(A.applyAt)}" data-duration="0.18" data-track-index="13" data-volume="0.42"></audio>`;

const chapters = SCENES.filter((s) => s.chapter).map((s) => `
      <div class="chapter clip" id="ch-${s.id}" data-start="${fx(s.cut + 0.35)}" data-duration="3.6"><span class="chapter__pill" id="chp-${s.id}">${esc(s.chapter)}</span></div>`).join('');

const subHtml = subs.filter((c) => c.start < hideSubsFrom).map((c, i) => `
      <div class="sub clip" id="sub-${i}" data-start="${fx(c.start)}" data-duration="${fx(c.end - c.start)}"><div class="sub__box" id="subb-${i}">${c.lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>`).join('');

// 40 futures for the rejected plan, 19 of them with a hospital waiting — the
// count is the planner's; the placement is a fixed spread.
const futures = (() => {
  // 21 is coprime with 40, so this stride visits 19 distinct cells.
  const red = new Set(Array.from({ length: 19 }, (_, i) => (i * 21 + 3) % 40));
  return Array.from({ length: 40 }, (_, i) => `<i class="${red.has(i) ? 'bad' : 'ok'}" id="fut-${i}"></i>`).join('');
})();

const html = `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>SupplyShock AI — demo</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Inter"; src: url("assets/fonts/Inter-400.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: block; }
      @font-face { font-family: "Inter"; src: url("assets/fonts/Inter-700.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: block; }
      :root {
        --graphite: #101520;
        --ink: #ffffff;
        --brand: #4f46e5;
        --brand-hi: #a5b4fc;
        --ok: #22c55e;
        --bad: #e5484d;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--graphite); }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: "Inter", sans-serif; color: var(--ink); background: var(--graphite); }

      /* footage */
      .vwrap { position: absolute; inset: 0; }
      .vwrap video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .vignette { position: absolute; inset: 0; z-index: 30; pointer-events: none;
        background: radial-gradient(ellipse 75% 70% at 50% 48%, rgba(10, 14, 22, 0) 60%, rgba(10, 14, 22, 0.26) 100%); }
      .fade-in { position: absolute; inset: 0; z-index: 70; background: var(--graphite); }
      .flash { position: absolute; inset: 0; z-index: 31; pointer-events: none;
        box-shadow: inset 0 0 260px 40px rgba(229, 72, 77, 0.55); }

      /* chapter kicker: top centre, clear of the app's panel and live-numbers strip */
      .chapter { position: absolute; left: 0; right: 0; top: 30px; z-index: 41; display: flex; justify-content: center; }
      .chapter__pill { display: block; padding: 11px 22px; border-radius: 999px; background: rgba(16, 21, 32, 0.88);
        font-size: 28px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #e2e8f0;
        box-shadow: 0 10px 30px rgba(10, 14, 22, 0.25); }
      .replay { position: absolute; left: 0; right: 0; top: 30px; z-index: 41; display: flex; justify-content: center; }
      .replay__pill { display: block; padding: 10px 20px; border-radius: 999px; background: rgba(79, 70, 229, 0.92);
        font-size: 28px; font-weight: 700; letter-spacing: 0.01em; color: #fff; box-shadow: 0 10px 30px rgba(79, 70, 229, 0.35); }

      /* subtitles: bottom centre, above the app's scrub bar */
      .sub { position: absolute; left: 0; right: 0; bottom: 110px; z-index: 65; display: flex; justify-content: center; }
      .sub__box { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 1280px; padding: 12px 26px 13px;
        border-radius: 16px; background: rgba(13, 18, 28, 0.84); box-shadow: 0 12px 34px rgba(10, 14, 22, 0.28); }
      .sub__box span { display: block; font-size: 38px; line-height: 1.24; font-weight: 400; letter-spacing: -0.005em; color: #fff; text-align: center; white-space: nowrap; }

      /* right-hand callout cards */
      .callout { position: absolute; right: 70px; top: 200px; width: 640px; z-index: 40; display: flex; }
      .card { display: block; width: 100%; padding: 34px 38px 36px; border-radius: 26px; background: rgba(16, 21, 32, 0.93);
        box-shadow: 0 30px 80px rgba(10, 14, 22, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08); }
      .card__kicker { display: block; font-size: 28px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94a3b8; }
      .card__big { display: block; font-size: 150px; line-height: 1; font-weight: 700; letter-spacing: -0.045em; margin-top: 14px; }
      .card__label { display: block; font-size: 30px; font-weight: 700; letter-spacing: -0.01em; margin-top: 10px; }
      .card__sub { display: block; font-size: 28px; font-weight: 400; color: #94a3b8; margin-top: 10px; line-height: 1.4; }
      .card__plan { display: block; font-size: 28px; font-weight: 700; margin-top: 12px; letter-spacing: -0.01em; }
      .card__row { display: flex; align-items: baseline; gap: 16px; margin-top: 16px; }
      .card__zero { display: block; font-size: 64px; font-weight: 700; letter-spacing: -0.03em; color: var(--ok); }
      .card__zerol { display: block; font-size: 30px; color: #cbd5e1; }
      .stamp { display: block; position: absolute; right: 26px; top: -26px; padding: 8px 18px; border-radius: 10px; border: 3px solid var(--bad); background: #1a0f14;
        color: var(--bad); font-size: 28px; font-weight: 700; letter-spacing: 0.12em; }
      .futures { display: grid; grid-template-columns: repeat(10, 1fr); gap: 9px; margin-top: 24px; }
      .futures i { display: block; aspect-ratio: 1; border-radius: 6px; background: #334155; }
      .verdict { display: block; margin-top: 22px; font-size: 32px; font-weight: 700; color: #fecaca; letter-spacing: -0.01em; }
      .verdict b { color: var(--bad); }
      .green { color: var(--ok); }

      /* title + end card */
      .scrim { position: absolute; inset: 0; z-index: 60; background: radial-gradient(ellipse 70% 60% at 50% 46%, rgba(16, 21, 32, 0.82), rgba(16, 21, 32, 0.55)); }
      .endbg { position: absolute; inset: 0; z-index: 60; background: var(--graphite); }
      .lockup { position: absolute; inset: 0; z-index: 61; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
      .mark { display: block; width: 96px; height: 96px; border-radius: 26px; position: relative;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 60%), conic-gradient(from 210deg, #4f46e5, #6366f1, #22c55e, #4f46e5);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4), 0 18px 50px rgba(79, 70, 229, 0.5); }
      .mark::after { content: ""; position: absolute; inset: 26px; border: 5px solid #fff; border-radius: 8px; transform: rotate(45deg); }
      .name { display: block; margin-top: 34px; font-size: 118px; line-height: 1; font-weight: 700; letter-spacing: -0.045em; }
      .name em { font-style: normal; color: var(--brand-hi); }
      .tag { display: block; margin-top: 22px; font-size: 32px; font-weight: 400; color: #cbd5e1; letter-spacing: -0.005em; }
      .question { display: block; margin-top: 46px; max-width: 1400px; text-wrap: balance; font-size: 76px; line-height: 1.08; font-weight: 700; letter-spacing: -0.035em; }
      .url { display: block; margin-top: 40px; padding: 14px 28px; border-radius: 999px; background: rgba(255, 255, 255, 0.08);
        font-size: 28px; font-weight: 700; letter-spacing: 0.01em; color: #e2e8f0; }
      .end-name { display: block; margin-top: 26px; font-size: 44px; font-weight: 700; letter-spacing: -0.03em; }
      .end-name em { font-style: normal; color: var(--brand-hi); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${TOTAL}">
${videos}

      <div class="vignette" id="vignette"></div>
      <div class="flash clip" id="flash" data-start="${fx(A.trigger)}" data-duration="1.4"></div>
      <div class="fade-in clip" id="fadein" data-start="0" data-duration="1.4"></div>
${chapters}
      <div class="replay clip" id="replay" data-start="${fx(A.replayFrom)}" data-duration="${fx(A.replayTo - A.replayFrom)}"><span class="replay__pill" id="replayp">Real results · replayed at reading speed</span></div>

      <!-- 04: the scale of the search -->
      <div class="callout clip" id="co-sims" data-start="${fx(A.simsIn)}" data-duration="${fx(S.s6.cut - A.simsIn)}">
        <div class="card" id="co-sims-card">
          <span class="card__kicker">Rehearsed in your browser</span>
          <span class="card__big" id="sims-n">0</span>
          <span class="card__label">simulated weeks</span>
          <span class="card__sub">8 strategies × 40 futures + the expected week. Under a second. No server.</span>
        </div>
      </div>

      <!-- 05: the plan it turned down -->
      <div class="callout clip" id="co-rival" data-start="${fx(A.rivalIn)}" data-duration="${fx(S.s7.cut - A.rivalIn)}">
        <div class="card" id="co-rival-card" style="position:relative">
          <span class="card__kicker">The tempting plan</span>
          <span class="card__plan">Backup supplier + Rebalance stock</span>
          <div class="card__row"><span class="card__zero">0</span><span class="card__zerol">late orders in the expected week</span></div>
          <span class="stamp" id="stamp">REJECTED</span>
          <div class="futures" id="futures">${futures}</div>
          <span class="verdict" id="verdict">A hospital waits in <b>19 of 40</b> futures.</span>
        </div>
      </div>

      <!-- 06: the outcome that matters -->
      <div class="callout clip" id="co-safe" data-start="${fx(A.saferIn)}" data-duration="${fx(S.s8.cut - A.saferIn)}">
        <div class="card" id="co-safe-card">
          <span class="card__kicker">Hospital orders late</span>
          <span class="card__big"><span id="safe-a">11</span> <span style="color:#64748b">→</span> <span class="green" id="safe-b">0</span></span>
          <span class="card__sub">With the plan, every hospital order arrives on time in 40 of 40 futures.</span>
        </div>
      </div>
${subHtml}

      <!-- title card, held in the pause after the hook -->
      <div class="scrim clip" id="title-scrim" data-start="${fx(A.titleIn)}" data-duration="${fx(S.s2.cut + 0.9 - A.titleIn)}"></div>
      <div class="lockup clip" id="title" data-start="${fx(A.titleIn)}" data-duration="${fx(S.s2.cut + 0.9 - A.titleIn)}">
        <span class="mark" id="title-mark"></span>
        <span class="name" id="title-name">SupplyShock <em>AI</em></span>
        <span class="tag" id="title-tag">A disruption simulator for medical-supply distributors</span>
      </div>

      <!-- end card -->
      <div class="endbg clip" id="end-bg" data-start="${fx(A.endIn)}" data-duration="${fx(TOTAL - A.endIn)}"></div>
      <div class="lockup clip" id="end" data-start="${fx(A.endIn)}" data-duration="${fx(TOTAL - A.endIn)}">
        <span class="mark" id="end-mark"></span>
        <span class="end-name" id="end-name">SupplyShock <em>AI</em></span>
        <span class="question" id="end-q">When one link breaks, who runs out first?</span>
        <span class="url" id="end-url">supplyshock-ai.vercel.app</span>
      </div>
${voice}
${sfx}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const E = "power3.out";

      // open from graphite
      tl.fromTo("#fadein", { opacity: 1 }, { opacity: 0, duration: 1.3, ease: "power1.inOut" }, 0.05);

      // crossfades: the outgoing shot dissolves over the incoming one
${SCENES.filter((s) => s.fade > 0).map((s) => `      tl.fromTo("#vw-${s.id}", { opacity: 1 }, { opacity: 0, duration: ${fx(s.fade)}, ease: "none" }, ${fx(s.end)});`).join('\n')}

      // title
      tl.fromTo("#title-scrim", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power2.out" }, ${fx(A.titleIn)});
      tl.fromTo("#title-mark", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, ${fx(A.titleIn + 0.05)});
      tl.fromTo("#title-name", { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: E }, ${fx(A.titleIn + 0.18)});
      tl.fromTo("#title-tag", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: E }, ${fx(A.titleIn + 0.45)});
      tl.to(["#title-scrim", "#title"], { opacity: 0, duration: 0.6, ease: "power2.in" }, ${fx(S.s2.cut + 0.3)});

      // the shock lands
      tl.fromTo("#flash", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power2.out" }, ${fx(A.trigger)});
      tl.to("#flash", { opacity: 0, duration: 1.1, ease: "power2.in" }, ${fx(A.trigger + 0.15)});

      // chapter kickers
${SCENES.filter((s) => s.chapter).map((s) => `      tl.fromTo("#chp-${s.id}", { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: E }, ${fx(s.cut + 0.35)});
      tl.to("#chp-${s.id}", { opacity: 0, duration: 0.45, ease: "power2.in" }, ${fx(s.cut + 3.4)});`).join('\n')}

      tl.fromTo("#replayp", { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: E }, ${fx(A.replayFrom)});
      tl.to("#replayp", { opacity: 0, duration: 0.4 }, ${fx(A.replayTo - 0.45)});

      // subtitles: a quick settle, never a slow fade
${subs.filter((c) => c.start < hideSubsFrom).map((c, i) => `      tl.fromTo("#subb-${i}", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.16, ease: "power2.out" }, ${fx(c.start)});`).join('\n')}

      // 04: count the simulations
      tl.fromTo("#co-sims-card", { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: E }, ${fx(A.simsIn)});
      const sims = { n: 0 };
      tl.to(sims, { n: 328, duration: 1.6, ease: "power2.out", onUpdate: () => { document.getElementById("sims-n").textContent = Math.round(sims.n); } }, ${fx(A.simsIn + 0.2)});
      tl.to("#co-sims-card", { opacity: 0, x: 40, duration: 0.45, ease: "power2.in" }, ${fx(S.s6.cut - 0.5)});

      // 05: the plan it turned down
      tl.fromTo("#co-rival-card", { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: E }, ${fx(A.rivalIn)});
      tl.set("#stamp", { opacity: 0 }, 0);
      tl.set("#verdict", { opacity: 0 }, 0);
      tl.set("#futures i", { opacity: 0.25 }, 0);
      tl.fromTo("#futures i", { opacity: 0.25, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.25, stagger: 0.045, ease: "power2.out" }, ${fx(A.rejectIn)});
      tl.to("#futures i.ok", { backgroundColor: "#16a34a", duration: 0.2, stagger: 0.03 }, ${fx(A.rejectIn + 0.1)});
      tl.to("#futures i.bad", { backgroundColor: "#e5484d", duration: 0.2, stagger: 0.05 }, ${fx(A.rejectIn + 0.3)});
      tl.fromTo("#stamp", { scale: 1.6, opacity: 0, rotation: -8 }, { scale: 1, opacity: 1, rotation: -8, duration: 0.35, ease: "back.out(2)" }, ${fx(A.rejectIn + 1.6)});
      tl.fromTo("#verdict", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: E }, ${fx(A.rejectIn + 1.9)});
      tl.to("#co-rival-card", { opacity: 0, x: 40, duration: 0.45, ease: "power2.in" }, ${fx(S.s7.cut - 0.5)});

      // 06: the outcome
      tl.fromTo("#co-safe-card", { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: E }, ${fx(A.saferIn)});
      tl.fromTo("#safe-b", { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2)" }, ${fx(A.saferIn + 0.7)});
      tl.to("#co-safe-card", { opacity: 0, x: 40, duration: 0.4, ease: "power2.in" }, ${fx(S.s8.cut - 0.45)});

      // end card
      tl.fromTo("#end-bg", { opacity: 0 }, { opacity: 0.94, duration: 1.0, ease: "power2.inOut" }, ${fx(A.endIn)});
      tl.fromTo("#end-mark", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, ${fx(A.endIn + 0.3)});
      tl.fromTo("#end-name", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: E }, ${fx(A.endIn + 0.45)});
      tl.set("#end-q", { opacity: 0 }, 0);
      tl.set("#end-url", { opacity: 0 }, 0);
      tl.fromTo("#end-q", { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: E }, ${fx(A.questionIn)});
      tl.fromTo("#end-url", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: E }, ${fx(A.questionIn + 2.2)});

      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

fs.writeFileSync(OUT, html);
const plan = SCENES.map((s) => ({ id: s.id, cut: r3(s.cut), dur: r3(s.dur), fade: r3(s.fade), voStart: r3(s.voStart), vo: r3(s.vo) }));
fs.writeFileSync(path.join(HERE, 'timeline.json'), JSON.stringify({ anchors: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, r3(v)])), scenes: plan, subtitles: subs.length }, null, 2));
console.table(plan);
console.log('anchors', Object.fromEntries(Object.entries(A).map(([k, v]) => [k, r3(v)])));
console.log(`subtitles: ${subs.filter((c) => c.start < hideSubsFrom).length} blocks · narration ${voTotal.toFixed(2)}s · gap between scenes ${between.toFixed(2)}s`);
