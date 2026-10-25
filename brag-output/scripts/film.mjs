// Capture the running app as deterministic 1080p footage, one MP4 per scene.
//
// Virtual time is advanced exactly one frame at a time, so every frame is
// rendered at a known clock position: the result is perfectly smooth no matter
// how long each frame actually took to draw. The app is driven through its own
// API (window.__supplyshock), not by clicking pixels.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, stepFrame, grab } from './cdp.mjs';

const FPS = 30;
const W = 1920;
const H = 1080;
// Needs the app's dev server on http://localhost:5173 (npm run dev at the repo root).
// Usage: node scripts/film.mjs [outDir] [s1 s2 ...]   (no scene ids = all scenes)
const OUT = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '../composition/assets/footage');
const ONLY = process.argv.slice(3).filter((a) => !a.startsWith('-'));

fs.mkdirSync(OUT, { recursive: true });

const cdp = await launch({ width: W, height: H, profile: 'film', port: 9340 });

async function js(expr) { return cdp.evaluate(`(() => { ${expr} })()`); }

console.log('loading app...');
await cdp.send('Page.navigate', { url: 'http://localhost:5173/' });
// Let the GLB load and the first simulation finish under real time.
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const ready = await cdp.evaluate('!!(window.__supplyshock && window.__supplyshock.run && window.__world)');
  if (ready) break;
}
await sleep(2500);

// Film setup: no intro, planner on the main thread (Web Workers do not advance
// under virtual time), and a clean start.
await js(`
  const app = window.__supplyshock;
  app.showIntro(false);
  app.noWorker = true;
  app.setPlaying(false);
  app.toggleFeed(false);
  window.__film = {
    orbit: null,
    setCam(px, py, pz, tx, ty, tz) {
      const w = window.__world;
      w.controls.target.set(tx, ty, tz);
      w.camera.position.set(px, py, pz);
      w.controls.update();
    },
    cam() {
      const w = window.__world;
      const p = w.camera.position, t = w.controls.target;
      return { p: [p.x, p.y, p.z], t: [t.x, t.y, t.z] };
    },
  };
`);
console.log('app ready');

/** Slow orbit around the current target: keeps a static panel scene alive. */
function orbitAt(base, frac, sweepDeg, rise = 0) {
  const [px, py, pz] = base.p;
  const [tx, ty, tz] = base.t;
  const dx = px - tx;
  const dz = pz - tz;
  const r = Math.hypot(dx, dz);
  const a0 = Math.atan2(dz, dx);
  const a = a0 + (sweepDeg * Math.PI / 180) * frac;
  return [tx + Math.cos(a) * r, py + rise * frac, tz + Math.sin(a) * r, tx, ty, tz];
}

/**
 * Capture a scene.
 *
 * `clock: [fromHour, toHour]` drives the simulation clock explicitly, one step
 * per captured frame, with playback paused. Virtual time does not advance the
 * app's own clock at a predictable rate, so pacing the week by hand is the only
 * way to say "this scene covers Monday to Friday" and mean it.
 */
async function record(name, seconds, onFrame, clock) {
  const frames = Math.round(seconds * FPS);
  if (clock) {
    await js(`window.__supplyshock.setPlaying(false);`);
    const inner = onFrame;
    onFrame = async (f, i, n) => {
      const t = clock[0] + (clock[1] - clock[0]) * (i / Math.max(1, n - 1));
      await js(`window.__supplyshock.t = ${t.toFixed(4)};`);
      if (inner) await inner(f, i, n);
    };
  }
  const file = path.join(OUT, `${name}.mp4`);
  const ff = spawn('ffmpeg', [
    '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'ignore', 'ignore'] });

  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    if (onFrame) await onFrame(i / frames, i, frames);
    await stepFrame(cdp, 1000 / FPS);
    const buf = await grab(cdp, 92);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  ${name}.mp4  ${seconds}s / ${frames}f  (captured in ${secs}s)`);
}

const facts = {};

// --------------------------------------------------------------- the scenes
const SCENES = {
  // 1. Cold open: panel folded away, slow push in across the quiet board.
  async s1() {
    await js(`
      const app = window.__supplyshock;
      app.togglePanel(false);
      app.t = 4;
      window.__world.home(0);
    `);
    await sleep(400);
    const base = await js('return window.__film.cam();');
    const away = { p: base.p.map((v, i) => v + (v - base.t[i]) * 0.30), t: base.t };
    return record('s1-cold-open', 13, async (f) => {
      const e = f * f * (3 - 2 * f); // smootherstep: starts and lands softly
      const p = away.p.map((v, i) => v + (base.p[i] - v) * e);
      await js(`window.__film.setCam(${p[0]},${p[1]},${p[2]},${base.t[0]},${base.t[1]},${base.t[2]});`);
    }, [4, 13]);
  },

  // 2. The problem: normal week running, then open a hub's stock card.
  async s2() {
    await js(`
      const app = window.__supplyshock;
      app.togglePanel(true);
      app.t = 10;
      window.__world.home(0);
    `);
    await sleep(400);
    return record('s2-normal-week', 18, async (f, i) => {
      if (i === 150) await js('window.__supplyshock.select("central");');
    }, [10, 34]);
  },

  // 3. Break a link: walk the four cards, set the duration, trigger it.
  async s3() {
    await js(`
      const app = window.__supplyshock;
      app.select(null);
      app.setPlaying(false);
      app.t = 6.5;
      app.draft = { type: 'port', days: 4, target: 'central' };
      app.mode = 'normal';
      app.renderPanel();
      window.__world.home(0);
    `);
    await sleep(500);
    return record('s3-break-a-link', 20, async (f, i) => {
      // Walk the scenario cards so the four options read on screen.
      if (i === 60) await js(`const a=window.__supplyshock; a.draft={...a.draft,type:'hub',days:3}; a.renderPanel();`);
      if (i === 105) await js(`const a=window.__supplyshock; a.draft={...a.draft,type:'bridge',days:3}; a.renderPanel();`);
      if (i === 150) await js(`const a=window.__supplyshock; a.draft={...a.draft,type:'supplier',days:3}; a.renderPanel();`);
      if (i === 195) await js(`const a=window.__supplyshock; a.draft={...a.draft,type:'port',days:4}; a.renderPanel();`);
      if (i === 270) await js(`window.__supplyshock.trigger();`);
    });
  },

  // 4. The ripple: read the impact, then let the week run at speed.
  async s4() {
    await js(`
      const app = window.__supplyshock;
      window.__world.home(0);
    `);
    await sleep(300);
    facts.impact = await js(`
      const app = window.__supplyshock;
      const m = app.impact.expected.metrics;
      return {
        late: m.late, orders: m.orders, critLate: m.critLate,
        recoveryH: m.recoveryH, recovered: m.recovered,
        chain: document.querySelectorAll('.tl-item').length,
        panelText: document.querySelector('.panel').innerText.slice(0, 1400),
      };
    `);
    return record('s4-the-ripple', 25, null, [6.5, 112]);
  },

  // 5. The planner: the strategy x future grid filling in.
  //
  // The real search finishes in well under a second, which is the product's
  // whole point but gives the camera about one second of its best visual. So
  // the search is run for real, then its actual per-future results are replayed
  // into the real thinking panel at a pace an audience can follow. The data on
  // screen is the search's own output; only the clock is slowed, and the
  // narration says so.
  async s5() {
    await js(`
      const app = window.__supplyshock;
      app.setPlaying(false);
      // Stand the scenario up when this scene is shot on its own.
      if (!app.scenario) {
        app.t = 6.5;
        app.draft = { type: 'port', days: 4, target: 'central' };
        app.trigger();
      }
      app.t = app.scenario.start;
      window.__world.home(0);
      app.plan();
    `);
    // Let the real search finish: its awaits only resolve as virtual time moves.
    for (let i = 0; i < 90; i++) {
      await stepFrame(cdp, 1000 / FPS);
      if (await cdp.evaluate('!!(window.__supplyshock.search)')) break;
    }
    await js(`
      const LABEL = { backup: 'Backup supplier', rebalance: 'Rebalance stock', reroute: 'Reroute', prioritize: 'Hospitals first' };
      const app = window.__supplyshock;
      window.__film.planner = {
        prep() {
          this.opts = app.search.options;
          this.runs = app.search.runs;
          this.titles = this.opts.map((o) => (o.actions.length ? o.actions.map((a) => LABEL[a]).join(' + ') : 'Wait it out'));
          app.mode = 'thinking';
          app.panelMode = null;
          app.renderPanel();
          app.renderStatus();
          this.cells = Array.from(document.querySelectorAll('#think-grid i'));
        },
        set(frac) {
          const total = this.opts.length * this.runs;
          const done = Math.floor(Math.max(0, Math.min(1, frac)) * total);
          for (let k = 0; k < this.cells.length; k++) {
            const row = Math.floor(k / this.runs);
            const col = k % this.runs;
            const want = k < done ? (this.opts[row].stats.safe[col] ? 'is-good' : 'is-bad') : '';
            if (this.cells[k].className !== want) this.cells[k].className = want;
          }
          const bar = document.getElementById('think-bar');
          if (bar) bar.style.width = (Math.min(1, frac) * 100).toFixed(1) + '%';
          const tx = document.getElementById('think-text');
          const row = Math.min(this.opts.length - 1, Math.floor(frac * this.opts.length));
          if (tx) tx.textContent = 'Testing \\u201C' + this.titles[row] + '\\u201D \\u00B7 ' + this.opts[row].stats.late.toFixed(1) + ' late orders on average';
        },
        finish() {
          app.mode = 'plans';
          app.panelMode = null;
          app.chosen = null;
          app.renderPanel();
          app.renderStatus();
        },
      };
      window.__film.planner.prep();
    `);
    const base = await js('return window.__film.cam();');
    return record('s5-the-planner', 30, async (f, i, n) => {
      // settle (0-1.5s), fill (1.5-27s), hold full grid, then flip to the plan
      const fillFrom = 1.5 * FPS;
      const fillTo = 27 * FPS;
      const frac = Math.max(0, Math.min(1, (i - fillFrom) / (fillTo - fillFrom)));
      await js(`window.__film.planner.set(${frac.toFixed(5)});`);
      if (i === Math.round(28.6 * FPS)) await js(`window.__film.planner.finish();`);
      const c = orbitAt(base, f, -7);
      await js(`window.__film.setCam(${c.join(',')});`);
    });
  },

  // 6. The plan: the recommendation, the numbers, and the "why not".
  async s6() {
    // Stand the scenario and the search up when this scene is shot on its own.
    if (!(await cdp.evaluate('!!(window.__supplyshock.search)'))) {
      await js(`
        const app = window.__supplyshock;
        app.setPlaying(false);
        if (!app.scenario) { app.t = 6.5; app.draft = { type: 'port', days: 4, target: 'central' }; app.trigger(); }
        app.t = app.scenario.start;
        window.__world.home(0);
        app.plan();
      `);
      for (let i = 0; i < 120; i++) {
        await stepFrame(cdp, 1000 / FPS);
        if (await cdp.evaluate('window.__supplyshock.mode === "plans"')) break;
      }
    }
    facts.plan = await js(`
      const r = window.__supplyshock.search;
      return {
        strategies: r.strategies, runs: r.runs, simulations: r.simulations, ms: Math.round(r.ms),
        panelText: document.querySelector('.panel').innerText.slice(0, 2000),
      };
    `);
    const base = await js('return window.__film.cam();');
    return record('s6-the-plan', 26, async (f, i) => {
      // Let the eye read the card, then scroll to the "why not" reasoning.
      if (i === 330) await js(`document.querySelector('.panel').scrollTo({ top: 520, behavior: 'smooth' });`);
      const c = orbitAt(base, f, -6);
      await js(`window.__film.setCam(${c.join(',')});`);
    });
  },

  // 7. Recovery: apply the plan and replay the week in green.
  async s7() {
    await js(`
      const app = window.__supplyshock;
      document.querySelector('.panel').scrollTo({ top: 0 });
      window.__world.home(0);
      app.apply();
    `);
    await sleep(300);
    return record('s7-recovery', 20, null, [6.5, 132]);
  },

  // 8. Close: let it finish, pull back, calm board.
  async s8() {
    await js(`
      const app = window.__supplyshock;
      app.t = app.run.horizon - 10;
      window.__world.home(0);
    `);
    await sleep(300);
    facts.final = await js(`
      const app = window.__supplyshock;
      return { panelText: document.querySelector('.panel').innerText.slice(0, 1200) };
    `);
    const base = await js('return window.__film.cam();');
    const H = await js('return window.__supplyshock.run.horizon;');
    return record('s8-close', 12, async (f) => {
      const c = orbitAt(base, f, 8, 6);
      await js(`window.__film.setCam(${c.join(',')});`);
    }, [H - 10, H - 0.2]);
  },
};

const order = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
for (const key of order) {
  if (ONLY.length && !ONLY.includes(key)) continue;
  console.log(`scene ${key}...`);
  await SCENES[key]();
}

fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2));
console.log('facts written');
cdp.close();
process.exit(0);
