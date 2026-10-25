// App controller: owns the clock and the guided flow
//   1 Break it -> 2 See the ripple -> 3 Recover (AI planner) -> 4 Recovery & report
import {
  SITES, SKUS, SKU_IDS, SCENARIOS, HUB_IDS, START_TIME, BASE_HORIZON, BACKUP, CUSTOMER_IDS,
} from '../data/network.js';
import { simulate } from '../sim/engine.js';
import {
  analyzeImpact, searchPlansAsync, rank, OBJECTIVES, runPlan, extraCost, extraCo2,
} from '../sim/planner.js';
import {
  kpisAt, eventsUntil, fmtTime, overdueSeries, hubState, customerState, portState, backupState,
  stockAt, dailyDemand,
} from '../sim/query.js';
import {
  planTitle, scenarioSentence, rippleChain, actionDetails, planReason,
} from '../sim/explain.js';
import { beaconFor } from '../scene/map.js';
import { icon, SITE_ICON } from './icons.js';
import { lineChart } from './charts.js';
import {
  money, int, pct, days, co2, oneDecimal,
} from './format.js';
import { buildReport, summaryText } from './report.js';

const RATE = 0.5; // simulated hours per real second at 1x
const STEPS = ['Break it', 'See the ripple', 'Recover', 'Report'];
const $ = (id) => document.getElementById(id);

export class App {
  constructor(map) {
    this.map = map;
    this.t = START_TIME;
    this.playing = true;
    this.speed = 1;
    this.mode = 'normal';
    this.draft = { type: 'port', days: SCENARIOS.port.days.default, target: 'central' };
    this.objective = 'balanced';
    this.selected = null;
    this.uiTick = -1;
    this.feedKey = null;
  }

  async boot() {
    const fill = $('loader-fill');
    await this.map.init($('map'), (p) => { fill.style.width = `${10 + p * 80}%`; });
    $('loader-text').textContent = 'Simulating a normal week…';
    this.normalRun = simulate({ horizon: BASE_HORIZON });
    this.setRun(this.normalRun);
    this.map.on('select', (id) => this.select(id));
    this.bindChrome();
    this.renderPanel();
    this.renderStatus();
    fill.style.width = '100%';
    setTimeout(() => {
      $('loader').classList.add('is-done');
      const shot = new URLSearchParams(window.location.search).get('shot');
      if (shot) this.runShot(shot);
      else this.showIntro(true);
    }, 300);
    this.last = performance.now();
    requestAnimationFrame((n) => this.frame(n));
  }

  // ------------------------------------------------------------------ clock
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.playing) {
      this.t += dt * RATE * this.speed;
      const H = this.run.horizon;
      if (this.t >= H) {
        if (this.mode === 'normal') {
          this.t = START_TIME;
        } else {
          this.t = H;
          this.setPlaying(false);
          if (this.mode === 'recovering') this.toast('Simulation complete — download the report to share it', 'CircleCheck');
        }
      }
    }
    this.map.update(this.t, dt);
    this.tickUI();
    requestAnimationFrame((n) => this.frame(n));
  }

  setRun(run) {
    this.run = run;
    this.map.setRun(run);
    this.renderTrack();
    this.uiTick = -1;
    this.feedKey = null;
  }

  setPlaying(on) {
    this.playing = on;
    $('btn-play').innerHTML = icon(on ? 'Pause' : 'Play', 18, 2.4);
  }

  locked() { return this.mode === 'thinking' || this.mode === 'plans'; }

  // ---------------------------------------------------------------- chrome
  bindChrome() {
    $('btn-play').addEventListener('click', () => {
      if (this.locked()) return this.toast('Pick a recovery plan first — the clock is paused while you decide', 'Info');
      this.setPlaying(!this.playing);
    });
    this.setPlaying(true);
    document.querySelectorAll('.speed button').forEach((b) => {
      b.classList.toggle('is-on', Number(b.dataset.speed) === this.speed);
      b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)));
    });
    $('btn-help').innerHTML = icon('Info', 16);
    $('btn-help').addEventListener('click', () => this.showIntro(true));
    $('intro-start').innerHTML = `${icon('Zap', 16)} Start a stress test`;
    $('intro-start').addEventListener('click', () => {
      this.showIntro(false);
      const btn = document.querySelector('[data-act="trigger"]');
      btn?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 600, iterations: 2 });
    });
    $('intro-explore').addEventListener('click', () => this.showIntro(false));
    $('btn-home').innerHTML = icon('LocateFixed', 16);
    $('btn-home').addEventListener('click', () => this.map.home());
    $('btn-reset').innerHTML = `${icon('RotateCcw', 14)}<span>Reset</span>`;
    $('btn-reset').addEventListener('click', () => this.reset());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        $('btn-play').click();
      }
      if (e.code === 'Escape') this.select(null);
    });
    $('panel').addEventListener('click', (e) => this.onPanelClick(e));
    $('panel').addEventListener('input', (e) => this.onPanelInput(e));
    $('inspector').addEventListener('click', (e) => this.onPanelClick(e));

    const track = $('track');
    const seek = (e) => {
      const r = track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.t = Math.max(0, f * this.run.horizon);
      this.uiTick = -1;
    };
    track.addEventListener('pointerdown', (e) => {
      if (this.locked()) return this.toast('Pick a recovery plan first — the clock is paused while you decide', 'Info');
      track.setPointerCapture(e.pointerId);
      this.scrubbing = true;
      seek(e);
    });
    track.addEventListener('pointermove', (e) => { if (this.scrubbing) seek(e); });
    track.addEventListener('pointerup', () => { this.scrubbing = false; });
  }

  /** ?shot=overview|impact|plan|recovery puts the app in a fixed state (used for README screenshots). */
  async runShot(kind) {
    this.noWorker = true; // headless capture clocks don't drive Web Workers
    const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
    if (kind === 'overview') {
      this.t = 8.2;
      this.setPlaying(false);
      return;
    }
    this.t = 6.5;
    this.trigger();
    await wait(4200);
    if (kind === 'impact') return;
    await this.plan();
    if (kind === 'plan') return;
    this.apply();
    this.t = this.scenario.start + 27;
    await wait(1200);
    this.setPlaying(false);
  }

  showIntro(on) {
    $('intro').hidden = !on;
    // Hold the clock while the intro is open so the opening scene is still ahead.
    if (on) {
      this.wasPlaying = this.playing;
      this.setPlaying(false);
    } else if (this.wasPlaying !== undefined) {
      this.setPlaying(this.wasPlaying);
    }
  }

  setSpeed(s) {
    this.speed = s;
    document.querySelectorAll('.speed button').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.speed) === s));
  }

  toast(text, ic = 'Info') {
    const el = $('toast');
    el.innerHTML = `${icon(ic, 15)}<span>${text}</span>`;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  renderStatus() {
    const el = $('status');
    const sc = this.scenario;
    let cls = 'status';
    let text = 'All systems normal';
    if (this.mode === 'impact') { cls += ' status--bad'; text = `Disruption · ${SCENARIOS[sc.type].title}`; }
    if (this.mode === 'thinking') { cls += ' status--think'; text = 'AI planner simulating futures…'; }
    if (this.mode === 'plans') { cls += ' status--bad'; text = 'Disruption · choose a recovery plan'; }
    if (this.mode === 'recovering') {
      const over = this.t >= sc.start + sc.days * 24;
      cls += over ? '' : ' status--ai';
      text = over ? 'Disruption over · network recovered' : `Recovery plan active · ${SCENARIOS[sc.type].title}`;
    }
    if (el.className !== cls) el.className = cls;
    if (el.textContent !== text) el.textContent = text;
  }

  // -------------------------------------------------------------- timeline
  renderTrack() {
    const H = this.run.horizon;
    const pos = (t) => `${((t / H) * 100).toFixed(2)}%`;
    const daysHtml = [];
    const short = window.innerWidth < 760;
    for (let d = 0; d * 24 < H; d++) daysHtml.push(`<span style="left:${pos(d * 24 + 12)}">${short ? 'D' : 'Day '}${d + 1}</span>`);
    $('track-days').innerHTML = daysHtml.join('');
    const marks = [];
    const sc = this.run.scenario;
    if (sc) marks.push(`<i class="mark-band" style="left:${pos(sc.start)};width:${((Math.min(H, sc.end) - sc.start) / H * 100).toFixed(2)}%" title="Disruption"></i>`);
    for (const v of this.run.vessels) {
      if (v.arrive > H) continue;
      marks.push(`<span class="mark-ship${v.held ? ' is-held' : ''}" style="left:${pos(v.arrive)}" title="Ship arrives ${fmtTime(v.arrive)}">${icon('Ship', 12, 2.2)}</span>`);
    }
    const seen = new Set();
    for (const s of this.run.stockouts) {
      const k = `${s.hub}`;
      if (seen.has(k)) continue;
      seen.add(k);
      marks.push(`<i class="mark-dot" style="left:${pos(s.t)}" title="${SITES[s.hub].name} stockout · ${fmtTime(s.t)}"></i>`);
    }
    if (this.run.plan) marks.push(`<i class="mark-flag" style="left:${pos(this.run.plan.at)}" title="AI plan applied"></i>`);
    $('track-marks').innerHTML = marks.join('');
  }

  tickUI() {
    const H = this.run.horizon;
    const f = `${((this.t / H) * 100).toFixed(3)}%`;
    $('track-fill').style.width = f;
    $('track-thumb').style.left = f;
    const clock = fmtTime(this.t);
    if ($('clock').textContent !== clock) $('clock').textContent = clock;

    const q = Math.floor(this.t * 4);
    const now = performance.now();
    if (q === this.uiTick || (this.uiTick !== -1 && now - (this.uiAt || 0) < 120)) return;
    this.uiTick = q;
    this.uiAt = now;
    this.renderKpis();
    this.renderFeed();
    this.renderStatus();
    if (this.selected) this.renderInspector();
    if (this.mode === 'recovering') this.renderLive();
  }

  renderKpis() {
    const k = kpisAt(this.run, this.t);
    const tone = (v, good, warn) => (v >= good ? 'ok' : v >= warn ? 'warn' : 'bad');
    const tiles = [
      { label: 'Orders on time', value: pct(k.onTime), tone: tone(k.onTime, 0.985, 0.9) },
      { label: 'Hospital orders late', value: int(k.critLate), tone: k.critLate ? 'bad' : 'ok' },
      { label: 'Trucks on the road', value: `${k.trucks}${k.aiTrucks ? `<small style="font-size:11px;color:#16A34A;font-weight:600"> · ${k.aiTrucks} AI</small>` : ''}`, tone: '' },
      { label: 'Stock on hand', value: `${oneDecimal(k.cover)} d`, tone: k.cover < 1 ? 'bad' : k.cover < 1.6 ? 'warn' : '' },
    ];
    $('kpis').innerHTML = tiles.map((x) => `<div class="kpi${x.tone ? ` kpi--${x.tone}` : ''}"><div class="kpi__label">${x.label}</div><div class="kpi__value">${x.value}</div></div>`).join('');
  }

  renderFeed() {
    const items = eventsUntil(this.run, this.t, 4);
    const key = items.map((e) => `${e.t}${e.text}`).join('|');
    if (key === this.feedKey) return;
    this.feedKey = key;
    $('feed').innerHTML = items.length
      ? items.map((e) => `<li class="feed__item feed__item--${e.tone}"><i></i><div>${e.text}<time>${fmtTime(e.t)}</time></div></li>`).join('')
      : '<li class="feed__item"><i></i><div>Quiet so far — orders are flowing normally.</div></li>';
  }

  // ----------------------------------------------------------------- panel
  stepsHtml(i) {
    return `<div class="steps" aria-label="Step ${i + 1} of 4">${STEPS.map((_, k) => `<span class="${k < i ? 'is-done' : k === i ? 'is-now' : ''}"></span>`).join('')}</div>`
      + `<div class="step-label">Step ${i + 1} · ${STEPS[i]}</div>`;
  }

  renderPanel() {
    const html = {
      normal: () => this.panelNormal(),
      impact: () => this.panelImpact(),
      thinking: () => this.panelThinking(),
      plans: () => this.panelPlans(),
      recovering: () => this.panelRecovering(),
    }[this.mode]();
    const panel = $('panel');
    panel.innerHTML = `<div class="panel__body">${html}</div>`;
    panel.scrollTop = 0;
  }

  panelNormal() {
    const d = this.draft;
    const sc = SCENARIOS[d.type];
    const cards = Object.values(SCENARIOS).map((s) => `
      <button class="scenario${s.id === d.type ? ' is-on' : ''}" data-act="pick" data-type="${s.id}">
        <span class="scenario__icon">${icon(s.icon, 16)}</span>
        <span class="scenario__title">${s.title}</span>
        <span class="scenario__blurb">${s.blurb}</span>
      </button>`).join('');
    const target = sc.targets ? `
      <div class="field"><div class="field__label">Which hub?</div>
        <div class="seg">${sc.targets.map((h) => `<button data-act="target" data-target="${h}" class="${h === d.target ? 'is-on' : ''}">${SITES[h].short}</button>`).join('')}</div>
      </div>` : '';
    return `${this.stepsHtml(0)}
      <h2>Stress-test your supply chain</h2>
      <p class="lead">A regional medical-supply network is running normally. Break one link and SupplyShock shows how the shock ripples out to hospitals. Then an AI planner finds the best way to recover.</p>
      <div class="scenarios">${cards}</div>
      <div class="config">
        ${target}
        <div class="field">
          <div class="field__label">How long will it last? <b id="days-val">${d.days} day${d.days > 1 ? 's' : ''}</b></div>
          <input type="range" min="${sc.days.min}" max="${sc.days.max}" step="1" value="${d.days}" data-input="days" aria-label="Duration in days">
        </div>
      </div>
      <p class="hint">${icon('MousePointerClick', 15)} Tip: click any building on the map to see its stock and orders.</p>
      <div class="sticky-actions">
        <button class="btn btn--danger btn--block" data-act="trigger">${icon('Zap', 16)} Trigger ${sc.title.toLowerCase()}</button>
      </div>`;
  }

  panelImpact() {
    const sc = this.scenario;
    const { expected, risk } = this.impact;
    const m = expected.metrics;
    const chain = rippleChain(expected);
    const cost = extraCost(m, this.impact.horizon);
    const recovered = m.late ? (m.recovered ? days(m.recoveryH) : 'not this week') : 'no delay';
    const chart = lineChart({
      series: [
        { values: overdueSeries(expected), color: '#E5484D', fill: true },
        { values: new Float32Array(expected.horizon + 1), color: '#94A3B8', dash: '4 4' },
      ],
      horizon: expected.horizon,
      band: [sc.start, sc.end],
      now: this.t,
    });
    return `${this.stepsHtml(1)}
      <div class="headline">
        <span class="headline__icon">${icon(SCENARIOS[sc.type].icon, 20)}</span>
        <div><div class="headline__title">${SCENARIOS[sc.type].title}</div>
        <div class="headline__sub">Starts ${fmtTime(sc.start)} · lasts about ${sc.days} day${sc.days > 1 ? 's' : ''}</div></div>
      </div>
      <p class="lead">${scenarioSentence(sc)}</p>
      <div class="section-title">If you do nothing</div>
      <div class="stats stats--3">
        <div class="stat ${m.late ? 'stat--bad' : 'stat--ok'}"><div class="stat__label">Late orders</div><div class="stat__value">${m.late}</div><div class="stat__sub">of ${m.orders}</div></div>
        <div class="stat ${m.critLate ? 'stat--bad' : 'stat--ok'}"><div class="stat__label">For hospitals</div><div class="stat__value">${m.critLate}</div><div class="stat__sub">patients wait</div></div>
        <div class="stat"><div class="stat__label">Back to normal</div><div class="stat__value">${recovered}</div><div class="stat__sub">after it starts</div></div>
      </div>
      <div class="cost-line">${icon('DollarSign', 13)} Costs about <b>${money(cost)}</b> · ${int(risk.lateP10)}–${int(risk.lateP90)} late orders across 40 possible futures</div>
      <div class="section-title">How the shock spreads</div>
      <div class="timeline-list">${chain.slice(0, 5).map((c) => `<div class="tl-item"><time>${fmtTime(c.t)}</time><span><span class="chip chip--${c.tone}">${c.text}</span></span></div>`).join('')}
        ${chain.length <= 1 ? '<div class="tl-item"><time></time><span class="chip">Stock buffers absorb it this time</span></div>' : ''}
      </div>
      <div class="section-title">Orders overdue, hour by hour</div>
      <div class="chart-card">${chart}<div class="chart-legend"><span><i style="background:#E5484D"></i>Do nothing</span><span><i style="background:#94A3B8"></i>Normal week</span><span><i style="background:rgba(229,72,77,.25)"></i>Disruption</span></div></div>
      <div class="sticky-actions">
        <button class="btn btn--ai btn--block" data-act="plan">${icon('Sparkles', 16)} Find recovery plans with AI</button>
        <button class="btn btn--ghost btn--block" data-act="watch">${icon(this.playing ? 'Pause' : 'Play', 15)} ${this.playing ? 'Pause' : 'Watch it unfold with no plan'}</button>
      </div>`;
  }

  resultsHtml(base, plan, H) {
    const rows = [
      { label: 'Late orders', ic: 'Package', a: base.late, b: plan.late, fmt: (v) => int(v) },
      { label: 'Hospital orders late', ic: 'HeartPulse', a: base.critLate, b: plan.critLate, fmt: (v) => int(v) },
      { label: 'Back to normal', ic: 'Timer', a: base.late ? base.recoveryH : 0, b: plan.late ? plan.recoveryH : 0, fmt: (v) => (v ? days(v) : '0 days') },
      { label: 'Disruption cost', ic: 'DollarSign', a: extraCost(base, H), b: extraCost(plan, H), fmt: money, money: true },
    ];
    return `<div class="results">${rows.map((r) => {
      let delta = '<span class="result__delta result__delta--flat">same</span>';
      if (r.a > 0 && r.b < r.a - 1e-6) delta = `<span class="result__delta result__delta--good">↓ ${Math.round(((r.a - r.b) / r.a) * 100)}%</span>`;
      else if (r.b > r.a + 1e-6) delta = `<span class="result__delta result__delta--bad">${r.money ? `+${money(r.b - r.a)}` : `↑ ${int(r.b - r.a)}`}</span>`;
      return `<div class="result"><span class="result__label">${icon(r.ic, 13)} ${r.label}</span><span class="result__vals"><s>${r.fmt(r.a)} →</s> ${r.fmt(r.b)}</span>${delta}</div>`;
    }).join('')}</div>`;
  }

  panelThinking() {
    return `${this.stepsHtml(2)}
      <h2>AI planner at work</h2>
      <p class="lead">Trying every combination of recovery moves, and playing each one out across 40 possible futures where demand, travel times and the disruption’s real length all vary.</p>
      <div class="thinking">
        <div class="thinking__text">${icon('Sparkles', 16)}<span id="think-text">Preparing…</span></div>
        <div class="thinking__bar"><i id="think-bar"></i></div>
        <div class="thinking__grid" id="think-grid">${'<i></i>'.repeat(160)}</div>
        <div class="footnote" id="think-foot">${icon('Info', 13)} Each square is a simulated week.</div>
      </div>`;
  }

  panelPlans() {
    const ranked = rank(this.search, this.objective);
    const option = this.chosen || ranked[0];
    const isPick = option.id === ranked[0].id;
    const baseline = this.search.options.find((o) => o.id === 'none');
    const runnerUp = ranked.find((o) => o.id !== option.id && o.id !== 'none');
    const steps = actionDetails(option, this.scenario);
    const cols = [baseline, option, runnerUp].filter(Boolean);
    const H = this.search.horizon;
    const cell = (o, v) => `<td class="${o === option ? 'col-pick' : ''}">${v}</td>`;
    const rows = [
      ['Late orders', (o) => int(o.expected.late)],
      ['Hospital orders late', (o) => int(o.expected.critLate)],
      ['Back to normal', (o) => (o.expected.late ? days(o.expected.recoveryH) : 'no delay')],
      ['Disruption cost', (o) => money(extraCost(o.expected, H))],
      ['Extra CO₂', (o) => co2(extraCo2(o.expected, H))],
      ['Hospitals safe in', (o) => `${pct(o.stats.success)}`],
    ];
    const table = `<table class="compare"><tr><th></th>${cols.map((o) => `<th class="${o === option ? 'col-pick' : ''}">${o === baseline ? 'Do nothing' : o === option ? (isPick ? 'AI pick' : 'Your pick') : 'Runner-up'}</th>`).join('')}</tr>
      ${rows.map(([label, f]) => `<tr><td>${label}</td>${cols.map((o) => cell(o, f(o))).join('')}</tr>`).join('')}</table>`;
    const list = ranked.slice(0, 6).map((o, i) => `
      <button class="option${o.id === option.id ? ' is-on' : ''}" data-act="choose" data-id="${o.id}">
        <span class="option__radio"></span>
        <span><span class="option__name">${planTitle(o.actions)}</span><br><span class="option__meta">${int(o.expected.late)} late · hospitals safe in ${pct(o.stats.success)} · ${money(extraCost(o.expected, H))}</span></span>
        <span class="option__score">#${i + 1}</span>
      </button>`).join('');
    const noAction = option.id === 'none';
    return `${this.stepsHtml(2)}
      <h2>${noAction ? 'No action needed' : 'Your recovery plan'}</h2>
      <p class="lead">Picked from ${this.search.strategies} strategies, each played out across ${this.search.runs} possible futures.</p>
      <div class="seg" role="group" aria-label="Optimize for">${Object.entries(OBJECTIVES).map(([k, o]) => `<button data-act="objective" data-obj="${k}" class="${k === this.objective ? 'is-on' : ''}" title="${o.hint}">${o.label}</button>`).join('')}</div>
      <div class="plan" style="margin-top:12px">
        <span class="plan__badge">${icon(isPick ? 'Sparkles' : 'Check', 13)} ${isPick ? 'AI recommended' : 'Your pick'}</span>
        <div class="plan__title">${planTitle(option.actions)}</div>
        <p class="reason">${planReason(option.actions, this.scenario)}</p>
        <div class="plan__actions">${steps.map((a) => `<div class="action"><span class="action__icon">${icon(a.icon, 15)}</span><div><b>${a.title}</b>${a.text}</div></div>`).join('')}</div>
        ${this.resultsHtml(baseline.expected, option.expected, H)}
        <div class="confidence">
          <div class="confidence__row"><span>Every hospital order on time</span><b>${pct(option.stats.success)} of ${this.search.runs} futures</b></div>
          <div class="confidence__bar"><i style="width:${(option.stats.success * 100).toFixed(0)}%"></i></div>
        </div>
      </div>
      <details class="more">
        <summary>Compare all ${this.search.strategies} strategies ${icon('ChevronDown', 15)}</summary>
        <div>${table}<div class="options" style="margin-top:12px">${list}</div>
        <div class="footnote">${icon('Info', 13)} ${int(this.search.simulations)} simulations in ${int(this.search.ms)} ms, right in your browser. Late hospital orders always weigh most.</div></div>
      </details>
      <div class="sticky-actions">
        <button class="btn btn--go btn--block" data-act="apply">${icon('Check', 16)} ${noAction ? 'Continue without changes' : 'Apply plan and watch the recovery'}</button>
      </div>`;
  }

  panelRecovering() {
    const opt = this.applied;
    return `${this.stepsHtml(3)}
      <h2>${opt.actions.length ? `${planTitle(opt.actions)} is running` : 'Riding it out'}</h2>
      <p class="lead">${opt.actions.length ? 'Green trucks and routes are the AI plan in action. Watch the hub stock piles and hospital labels hold steady.' : 'No changes applied — the network plays out as forecast.'}</p>
      <div class="progress-note" id="live-note"></div>
      <div class="section-title">This week: no plan → with plan</div>
      ${this.resultsHtml(this.impact.expected.metrics, this.run.metrics, this.run.horizon)}
      <div class="section-title">Orders overdue, hour by hour</div>
      <div class="chart-card"><div id="live-chart"></div><div class="chart-legend"><span><i style="background:#E5484D"></i>Do nothing</span><span><i style="background:#16A34A"></i>With plan</span></div></div>
      <div class="sticky-actions">
        <button class="btn btn--ai btn--block" data-act="report">${icon('Printer', 16)} Download report (PDF)</button>
        <div class="btn-row">
          <button class="btn btn--ghost" data-act="copy">${icon('Copy', 15)} Copy summary</button>
          <button class="btn btn--ghost" data-act="reset">${icon('RotateCcw', 15)} New test</button>
        </div>
      </div>`;
  }

  renderLive() {
    const note = $('live-note');
    if (!note) return;
    const k = kpisAt(this.run, this.t);
    const kb = kpisAt(this.impact.expected, this.t);
    const ok = k.critLate === 0;
    note.innerHTML = `${icon(ok ? 'ShieldCheck' : 'TriangleAlert', 16)}<span>So far: <b>${k.critLate}</b> hospital orders late (${kb.critLate} without the plan) · <b>${k.late}</b> late overall (${kb.late})</span>`;
    note.style.background = ok ? '' : 'var(--warn-soft)';
    const hour = Math.floor(this.t);
    if (hour !== this.liveHour) {
      this.liveHour = hour;
      $('live-chart').innerHTML = lineChart({
        series: [
          { values: this.baseOverdue, color: '#E5484D', dash: '4 3', fill: true },
          { values: this.planOverdue, color: '#16A34A' },
        ],
        horizon: this.run.horizon,
        band: [this.scenario.start, this.scenario.end],
        now: this.t,
      });
    }
  }

  // ---------------------------------------------------------------- events
  onPanelInput(e) {
    if (e.target.dataset.input === 'days') {
      this.draft.days = Number(e.target.value);
      $('days-val').textContent = `${this.draft.days} day${this.draft.days > 1 ? 's' : ''}`;
    }
  }

  onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'pick') {
      const s = SCENARIOS[btn.dataset.type];
      this.draft = { ...this.draft, type: s.id, days: s.days.default };
      this.renderPanel();
      if (s.id === 'hub') this.map.focusSite(this.draft.target);
      else this.map.focusScenario({ type: s.id, days: s.days.default, target: this.draft.target });
    } else if (act === 'target') {
      this.draft.target = btn.dataset.target;
      this.renderPanel();
      this.map.focusSite(this.draft.target);
    } else if (act === 'trigger') {
      this.trigger();
    } else if (act === 'watch') {
      this.setPlaying(!this.playing);
      if (this.playing) this.setSpeed(3);
      this.renderPanel();
    } else if (act === 'plan') {
      this.plan();
    } else if (act === 'objective') {
      this.objective = btn.dataset.obj;
      this.chosen = null;
      this.renderPanel();
    } else if (act === 'choose') {
      this.chosen = this.search.options.find((o) => o.id === btn.dataset.id);
      this.renderPanel();
    } else if (act === 'apply') {
      this.apply();
    } else if (act === 'report') {
      this.printReport();
    } else if (act === 'copy') {
      navigator.clipboard?.writeText(summaryText(this.reportState())).then(
        () => this.toast('Summary copied — paste it into an email or chat', 'Check'),
        () => this.toast('Copy failed — your browser blocked clipboard access', 'Info'),
      );
    } else if (act === 'reset') {
      this.reset();
    } else if (act === 'close') {
      this.select(null);
    } else if (act === 'break') {
      this.draft = { ...this.draft, type: btn.dataset.type, target: btn.dataset.target || this.draft.target, days: SCENARIOS[btn.dataset.type].days.default };
      this.select(null);
      this.trigger();
    }
  }

  // ------------------------------------------------------------------ flow
  trigger() {
    if (this.mode !== 'normal') return;
    const d = this.draft;
    const sc = { type: d.type, days: d.days, start: Math.ceil(this.t * 2) / 2 };
    if (d.type === 'hub') sc.target = d.target;
    this.scenario = sc;
    this.impact = analyzeImpact(sc);
    this.scenario = this.impact.expected.scenario;
    this.setRun(this.impact.expected);
    this.t = sc.start;
    this.setPlaying(false);
    this.mode = 'impact';
    const chain0 = rippleChain(this.impact.expected).slice(1); // skip the disruption itself
    const hubsHit = new Set(chain0.filter((c) => SITES[c.site]?.type === 'hub').map((c) => c.site)).size;
    const custHit = new Set(chain0.filter((c) => SITES[c.site]?.demand).map((c) => c.site)).size;
    const sub = hubsHit || custHit
      ? [hubsHit && `${hubsHit} hub${hubsHit > 1 ? 's' : ''} run dry`, custHit && `${custHit} customer${custHit > 1 ? 's' : ''} hit`].filter(Boolean).join(' · ')
      : 'buffers absorb it';
    this.map.setScenario(this.scenario, sub);
    this.renderPanel();
    this.renderStatus();
    this.select(null);
    this.map.focusScenario(sc);
    const affected = [...new Set(rippleChain(this.impact.expected).map((c) => c.site).filter(Boolean))];
    const origin = beaconFor(sc, this.map.terrain.bridges);
    setTimeout(() => this.map.ripple(origin, affected), 900);
    setTimeout(() => { if (this.mode === 'impact') this.map.home(); }, 3600);
    this.toast('Clock paused — here’s how the shock spreads if you do nothing', 'TriangleAlert');
  }

  async plan() {
    if (this.mode !== 'impact') return;
    this.setPlaying(false);
    this.planAt = Math.max(this.scenario.start, Math.ceil(this.t * 4) / 4);
    this.mode = 'thinking';
    this.renderPanel();
    this.renderStatus();
    const cells = [...document.querySelectorAll('#think-grid i')];
    const started = performance.now();
    let lit = 0;
    const search = await this.searchInWorker(this.scenario, this.planAt, {
      runs: 40,
      onProgress: (p, opt) => {
        const n = Math.round(p * cells.length);
        for (; lit < n; lit++) cells[lit].className = opt.stats.success >= 0.9 ? 'is-good' : 'is-on';
        const bar = $('think-bar');
        if (bar) bar.style.width = `${(p * 100).toFixed(0)}%`;
        const tx = $('think-text');
        if (tx) tx.textContent = `Testing “${planTitle(opt.actions)}” · ${opt.stats.late.toFixed(1)} late orders on average`;
      },
    });
    // Let the animation breathe; the compute itself takes well under a second.
    const wait = Math.max(0, 1400 - (performance.now() - started));
    await new Promise((r) => { setTimeout(r, wait); });
    this.search = search;
    this.chosen = null;
    this.mode = 'plans';
    this.renderPanel();
    this.renderStatus();
  }

  /** Planner in a Web Worker (falls back to the main thread if workers are unavailable). */
  searchInWorker(scenario, at, { runs, onProgress }) {
    if (this.noWorker || typeof Worker === 'undefined') return searchPlansAsync(scenario, at, { runs, onProgress });
    return new Promise((resolve) => {
      let worker;
      try {
        worker = new Worker(new URL('../sim/planner.worker.js', import.meta.url), { type: 'module' });
      } catch {
        resolve(searchPlansAsync(scenario, at, { runs, onProgress }));
        return;
      }
      worker.onmessage = (e) => {
        if (e.data.type === 'progress') onProgress(e.data.p, e.data.opt);
        else {
          worker.terminate();
          resolve(e.data.result);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        resolve(searchPlansAsync(scenario, at, { runs, onProgress }));
      };
      worker.postMessage({ scenario, at, runs });
    });
  }

  apply() {
    if (this.mode !== 'plans') return;
    const ranked = rank(this.search, this.objective);
    const option = this.chosen || ranked[0];
    this.applied = option;
    this.appliedRanked = ranked;
    const run = runPlan(this.scenario, option, this.planAt);
    this.planRun = run;
    this.baseOverdue = overdueSeries(this.impact.expected);
    this.planOverdue = overdueSeries(run);
    this.liveHour = -1;
    this.setRun(run);
    this.mode = 'recovering';
    this.renderPanel();
    this.renderStatus();
    this.setSpeed(3);
    this.setPlaying(true);
    // A green ripple from where the plan acts
    const sources = new Set();
    for (const b of run.acts.batches) { sources.add('backup'); void b; }
    for (const tr of run.acts.transfers) sources.add(tr.from);
    for (const r of run.acts.reassigned) sources.add(r.to);
    const first = [...sources][0];
    const targets = new Set([...run.acts.transfers.map((tr) => tr.to), ...run.acts.reassigned.map((r) => r.customer)]);
    if (option.actions.includes('backup')) HUB_IDS.forEach((h) => targets.add(h));
    if (first) {
      const s = SITES[first];
      this.map.ripple({ x: s.pos[0], z: s.pos[1] }, [...targets], '#16A34A');
    } else if (option.actions.length) {
      this.map.ripple(beaconFor(this.scenario, this.map.terrain.bridges), [...targets], '#16A34A');
    }
    this.toast(option.actions.length ? `Plan applied: ${planTitle(option.actions)}` : 'Continuing without changes', 'Check');
  }

  reset() {
    this.mode = 'normal';
    this.scenario = null;
    this.impact = null;
    this.search = null;
    this.applied = null;
    this.chosen = null;
    this.map.setScenario(null);
    this.setRun(this.normalRun);
    this.t = START_TIME;
    this.setSpeed(1);
    this.setPlaying(true);
    this.select(null);
    this.renderPanel();
    this.renderStatus();
    this.map.home();
  }

  reportState() {
    const ranked = this.appliedRanked || rank(this.search, this.objective);
    return {
      scenario: this.scenario,
      impact: this.impact,
      search: this.search,
      option: this.applied,
      baselineOpt: this.search.options.find((o) => o.id === 'none'),
      runnerUp: ranked.find((o) => o.id !== this.applied.id && o.id !== 'none'),
      planRun: this.planRun,
    };
  }

  printReport() {
    $('report').innerHTML = buildReport(this.reportState());
    window.print();
  }

  // ------------------------------------------------------------- inspector
  select(id) {
    this.selected = id;
    this.map.setSelected(id);
    if (id) {
      this.renderInspector();
      this.map.focusSite(id);
    } else {
      $('inspector').hidden = true;
    }
  }

  renderInspector() {
    const id = this.selected;
    const s = SITES[id];
    if (!s) return;
    const el = $('inspector');
    const run = this.run;
    const t = this.t;
    let body = '';
    let sub = '';
    let action = '';
    const normal = this.mode === 'normal';
    if (s.type === 'hub') {
      const st = hubState(run, id, t);
      const served = CUSTOMER_IDS.filter((c) => SITES[c].hub === id).map((c) => SITES[c].short);
      sub = `Distribution hub · serves ${served.join(', ')}`;
      body = `<div class="sku-rows">${SKUS.map((k) => {
        const units = stockAt(run, id, k.id, t);
        const cover = st.cover[k.id];
        return `<div class="sku-row"><span>${k.name}</span><span class="sku-row__bar"><i style="width:${Math.min(100, (cover / 6) * 100).toFixed(0)}%;background:${k.color}"></i></span><span>${int(units)} · ${oneDecimal(cover)}d</span></div>`;
      }).join('')}</div>
      <dl class="kv"><dt>Status</dt><dd>${st.meta}</dd><dt>Daily demand</dt><dd>${int(SKU_IDS.reduce((a, k) => a + dailyDemand(id, k), 0))} units</dd></dl>`;
      if (normal) action = `<button class="btn btn--danger btn--block btn--sm" data-act="break" data-type="hub" data-target="${id}">${icon('PlugZap', 14)} Simulate a shutdown here</button>`;
    } else if (s.type === 'port') {
      const st = portState(run, t);
      const units = SKU_IDS.reduce((a, k) => a + stockAt(run, 'port', k, t), 0);
      const next = run.vessels.filter((v) => v.arrive > t).slice(0, 2).map((v) => `${fmtTime(v.arrive)}${v.held ? ' (delayed)' : ''}`);
      sub = 'Sea port · receives Kestrel Pharma shipments';
      body = `<dl class="kv"><dt>Status</dt><dd>${st.meta}</dd><dt>In the yard</dt><dd>${int(units)} units</dd><dt>Next ships</dt><dd>${next.join('<br>') || '—'}</dd></dl>`;
      if (normal) action = `<button class="btn btn--danger btn--block btn--sm" data-act="break" data-type="port">${icon('Ship', 14)} Simulate port congestion</button>`;
    } else if (s.type === 'supplier') {
      const st = backupState(run, t);
      sub = 'Local backup supplier · used only when ordered';
      body = `<dl class="kv"><dt>Status</dt><dd>${st.meta}</dd><dt>Rush capacity</dt><dd>${int(SKU_IDS.reduce((a, k) => a + BACKUP.batch[k], 0))} units / ${BACKUP.batchEvery} h</dd><dt>Lead time</dt><dd>${BACKUP.leadHours} h</dd><dt>Price premium</dt><dd>+${Math.round(BACKUP.premium * 100)}%</dd></dl>`;
    } else {
      const st = customerState(run, id, t);
      sub = `${s.critical ? 'Hospital · priority customer' : s.type === 'clinic' ? 'Clinic' : s.type === 'pharmacy' ? 'Pharmacy' : 'Care home'} · supplied by ${SITES[s.hub].name}`;
      body = `<dl class="kv"><dt>Status</dt><dd>${st.meta}</dd><dt>Orders delivered</dt><dd>${st.delivered}</dd><dt>Daily need</dt><dd>${SKUS.map((k) => `${s.demand[k.id]} ${k.name.toLowerCase()}`).join('<br>')}</dd></dl>`;
    }
    el.innerHTML = `<div class="inspector__head"><span class="inspector__icon">${icon(SITE_ICON[s.type], 18)}</span><div><div class="inspector__title">${s.name}</div><div class="inspector__sub">${sub}</div></div><button class="icon-btn inspector__close" data-act="close" aria-label="Close">${icon('X', 15)}</button></div>${body}${action}`;
    el.hidden = false;
  }
}
