---
doc: spec
status: draft
---

# SupplyShock AI — Technical Spec

## How This Works, In Plain Language
- **The network data** (`src/data/network.js`) lists every place (port, hubs, backup supplier, hospitals…), the roads between them, the products, demand, ship schedule and the four disruptions. Changing the business means changing this file.
- **The simulator** (`src/sim/engine.js`) plays one week hour by hour: customers order, hubs send trucks, the ship restocks the port, the port restocks the hubs. A disruption bends that flow (no berthing, a closed hub, a closed bridge, a partial shipment). It records every truck trip, stock level and order.
- **The AI planner** (`src/sim/planner.js`) runs the simulator again and again: for each combination of recovery levers it plays one expected week plus 40 weeks where demand, travel times and the disruption's real length vary. It scores the outcomes (late hospital orders count most) and recommends the best plan. `explain.js` turns the numbers into sentences.
- **The 3D map** (`src/scene/`) draws the simulator's run: trucks drive the recorded trips, crate piles follow recorded stock, the ship follows the recorded schedule, routes glow by status. All 3D models come from a Blender script (`blender/build_assets.py`).
- **The app** (`src/ui/`) owns the clock and the four-step flow, the panels, the timeline, the inspector and the report.

Why this shape: one deterministic simulator powers both the animation and the AI, so what you watch is exactly what the planner evaluated. No server, no API keys, works offline.

## The Core Journey Through the System
1. Load → `MapView.init` loads `public/models/supplyshock.glb`, builds the board → `simulate()` runs a normal week → the clock plays it.
2. Trigger → `analyzeImpact(scenario)` runs the do-nothing week + 40 futures → the map switches to that run, `ripple()` animates, the panel shows metrics and `rippleChain()`.
3. Find plans → `searchPlansAsync()` evaluates every lever combination → `objectivePicks()` takes each objective's best plan and merges objectives that agree → panel shows one choice per distinct plan with `actionDetails()`, `planReason()` and before/after.
4. Apply → `runPlan()` replays the week with the plan from the disruption's start → green trips/routes appear → live progress compares against the do-nothing run.
5. Report → `buildReport()` fills a print-only article → browser print/save as PDF.
PRD ref: `prd.md > The Core Journey`.

## Stack
- **Three.js r186** — WebGL rendering, GLTFLoader, OrbitControls, CSS2DRenderer for crisp labels. https://threejs.org/docs/
- **Blender 5.2** (headless, Python `bpy`) — procedural low-poly asset pack exported as GLB. https://docs.blender.org/api/current/
- **Vite 8** — dev server and static build. https://vite.dev/
- **Lucide** icons. https://lucide.dev/
- Vanilla JavaScript modules; Node's built-in test runner for engine tests.
Learner choices: Three.js + Blender, white UI. Agent choices: Vite, vanilla JS (small, easy to read), no backend.

## Where It Runs and How Someone Tries It
- Browser with WebGL. Node 20.19+ for development.
- `npm install` → `npm run dev` → open http://localhost:5173
- `npm test` runs the engine tests; `npm run build` makes a static site in `dist/` (any static host works).
- Rebuild 3D assets: `npm run assets` (needs Blender on PATH).
- Live deployment (optional, done): https://supplyshock-ai.vercel.app (Vercel, static build from `dist/`; the project is linked to the GitHub repo, so every push to `main` redeploys).
- Public repository: https://github.com/FuadAhamed91/supplyshock-ai
- Demo recording: start the dev server, choose "Start a stress test", trigger Port congestion early on Day 1, find plans, apply, download the report.

## Look and Feel
White diorama board on a soft blue-grey background, Inter, indigo accent; strict colour meaning (indigo normal, green AI recovery, amber at risk, red disrupted). Floating white cards with soft shadows; minimal copy; numbers in tabular figures.

## Components

### Network data — `src/data/network.js`
Sites, roads, river, bridges, products, demand, ship, backup supplier, operations constants, scenarios and levers. PRD ref: `prd.md > Features and Behavior`.

### Simulator — `src/sim/engine.js`, `graph.js`, `rng.js`, `query.js`
Discrete-event simulation with a priority queue; Dijkstra routing that can avoid closed roads; seeded RNG; read-only queries (hub/customer/port state, KPIs). PRD ref: `prd.md > Live network`, `prd.md > Disruptions`.

### AI planner — `src/sim/planner.js`, `explain.js`
Lever combinations × Monte Carlo futures, objective weights with a patient-safety guardrail, ranking, explanation text. PRD ref: `prd.md > AI recovery planner`.

### 3D map — `src/scene/*`
`world.js` renderer/camera, `terrain.js` board/roads/river/bridges/scenery, `sites.js` buildings/labels/stock piles, `vehicles.js` trucks and ships, `effects.js` route glow, shockwaves, beacons, barriers, smoke, `map.js` orchestration. PRD ref: `prd.md > Live network`.

### App shell — `src/ui/*`, `index.html`, `src/styles.css`
Clock, guided flow, KPIs, feed, timeline, inspector, intro, charts, report. PRD ref: `prd.md > Screens and Layout`.

### Asset pipeline — `blender/build_assets.py`, `blender/landmarks.py`
Builds 21 low-poly assets and exports one GLB. Shared props live in `build_assets.py` (truck, container ship, port crane, house, container, crate, pallet, barrier, two trees). `landmarks.py` holds the distinct landmarks: three different hubs, two different hospitals, clinic, pharmacy, care home, factory, port control tower and lighthouse. At load the app bakes each model into one vertex-coloured mesh for speed.

## Data Model
All in memory. A **run** = `{ scenario, plan, shipments[], orders[], vessels[], events[], stockouts[], series{site→sku→hourly stock}, acts, metrics }`. Nothing persists; reload starts fresh.

## File Structure
```
supplyshock-ai/
├── index.html              # app shell
├── public/models/          # supplyshock.glb (built by Blender)
├── blender/               # procedural 3D asset pack (build_assets.py, landmarks.py)
├── src/
│   ├── data/network.js     # the demo business
│   ├── sim/                # engine, routing, planner, explanations, queries
│   ├── scene/              # Three.js map
│   ├── ui/                 # app controller, charts, report, icons, formatting
│   └── styles.css
├── tests/engine.test.mjs   # engine + planner tests
├── scripts/                # calibration helpers (tune.mjs, sweep.mjs)
└── devpost/                # scope, PRD, spec, checklist, app map
```

## External Services and Dependencies
None at runtime besides Google Fonts (Inter; falls back to system fonts). No API keys.

## Important Failure Modes
- **No WebGL** → loader shows "Could not start the 3D view — try a browser with WebGL enabled."
- **Slow device** → pixel ratio capped at 1.5 and lowered towards 1 if frames stay slow; scenery is instanced; each model is baked into one mesh; the planner runs in a Web Worker.
- **Clipboard blocked** → toast explains the copy failed.

## What Was Simplified and Why
- **Rule-based dispatch and order-up-to replenishment** instead of a full optimizer — explainable and fast enough to run hundreds of times in the browser.
- **Four recovery levers** instead of free-form planning — keeps every recommendation concrete and checkable.
- **Template explanations from computed numbers** instead of an LLM — no keys, no hallucinated numbers.
- **One fictional network** instead of data import.

## Decisions and Open Issues
- Same simulator for animation and AI (agent) — what's on screen matches what was evaluated.
- Ranking uses Monte Carlo averages; the panels show the expected week plus "hospitals safe in X% of futures" so numbers stay consistent across screens (agent).
- Late hospital orders carry a guardrail weight (1,000,000 per expected late hospital order) in every objective (agent) — no objective may "optimise" by letting patients wait; a test checks that no objective's pick is less safe than the safest plan.
- Near-ties within 1.5% go to the plan with fewer levers when it protects hospitals equally (agent), so no lever is recommended that changes nothing.
- A supplier outage's missing cargo follows on later sailings (up to one extra load each), so the network recovers inside the simulated period (agent).
- Learner uncertainty: not established in this session.
- Open: learner review and approval of these planning docs.
