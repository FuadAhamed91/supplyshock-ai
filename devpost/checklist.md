---
doc: checklist
status: draft
---

# Build Checklist

Build mode: fast (the learner asked for the complete build and a commit when everything was done)

## Slices

- [x] **1. A 3D network you can watch running normally**
  Becomes usable: The app opens on a 3D diorama built from Blender assets; a normal week plays with ships, trucks and stock piles.
  Why now: Proves the asset pipeline, rendering and the simulator end to end.
  PRD ref: `prd.md > The Core Journey` (steps 1–2), `prd.md > Live network`
  Spec ref: `spec.md > Asset pipeline — blender/build_assets.py`, `spec.md > Simulator — src/sim/engine.js, graph.js, rng.js, query.js`, `spec.md > 3D map — src/scene/*`
  Build: Blender asset script, network data, discrete-event engine, Three.js board, trucks, ship, labels, KPIs, timeline.
  Verify (mechanical): `npm test` (normal week has zero late orders); dev server renders with no console errors.
  Learner check: Open the app, explore the map, click a hub.
  Commit: `Build the 3D network and simulation engine`

- [x] **2. Break a link and see the ripple**
  Becomes usable: Four disruptions with duration; impact panel, shockwave, red routes, ripple chain and overdue chart.
  Why now: The kernel — seeing the knock-on effect.
  PRD ref: `prd.md > Disruptions`
  Spec ref: `spec.md > AI planner — src/sim/planner.js, explain.js`
  Build: Scenario cards, `analyzeImpact`, ripple animation, beacon, impact panel.
  Verify (mechanical): `npm test` (port congestion holds the ship and causes late orders).
  Learner check: Trigger port congestion on Day 1 and read the impact.
  Commit: `Add disruptions and impact analysis`

- [x] **3. AI recovery plans**
  Becomes usable: Planner searches lever combinations across 40 futures, recommends and explains a plan, compares all strategies by objective.
  Why now: The second half of the kernel.
  PRD ref: `prd.md > AI recovery planner`
  Spec ref: `spec.md > AI planner — src/sim/planner.js, explain.js`
  Build: `searchPlansAsync`, objectives with guardrail, plan card, comparison.
  Verify (mechanical): `npm test` (best plan beats doing nothing for hospitals in all four scenarios).
  Learner check: Switch objectives and see the recommendation change.
  Commit: `Add the AI recovery planner`

- [x] **4. Watch the recovery and share the report**
  Becomes usable: Applying a plan replays the week with green AI trucks/routes; live progress; printable report and copyable summary.
  Why now: Closes the loop for the demo.
  PRD ref: `prd.md > Recovery playback and report`
  Spec ref: `spec.md > App shell — src/ui/*, index.html, src/styles.css`
  Build: `runPlan`, recovery panel, report, summary.
  Verify (mechanical): Report renders without errors; all four scenarios run end to end in the browser.
  Learner check: Apply the plan, then download the report.
  Commit: `Add recovery playback and report`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — learner to try the app
- [ ] Final kick-the-tires exploration and feedback completed

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [x] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: App map generated from the finished code; learning activity not yet done.
Route and stops: see `devpost/app-map.html`.
Edit outcome: not applicable yet.
Reflection: not yet offered.
Activity mode: reference-only route.

## Revisions

- Planning documents written after the build had started — the hackathon target changed mid-session, so the docs were reconstructed from decisions already made in conversation; awaiting learner approval.
- Port congestion and bridge closure default to 4 days and hubs start leaner — at 3 days the disruption only mattered if it caught an incoming ship, which made the demo depend on timing.
- Plan panels show the expected week rather than Monte Carlo averages — mixing the two made the impact and plan screens look contradictory.
- Full audit and polish pass (two independent code reviews plus a browser walkthrough). Simulator: supplier-outage backlog now ships on later sailings so every scenario recovers inside its horizon; hospitals-first rationing ends a day after the disruption; every rush unit paid for is shipped; detours report the bridge they actually use. Planner: hospital guardrail raised so no objective trades patient safety; near-ties go to the simpler plan; plans start when the disruption hits and the panel explains passed-over alternatives. Backup supplier IV-fluid capacity raised (150 → 180 per batch) so the port demo's recommended plan keeps hospitals safe in every simulated future. UI: consistent "back to normal" wording, live strategy × future grid while planning, keyboard timeline, contrast and focus fixes, phone and 1280×720 layouts, link-preview image, sample report. Tests: 6 → 13.
- Merged a teammate's glass restyle (glass buttons, frosted panels, recessed segmented controls, filled slider, reduced-motion support) with the audit changes; the red and green glass tints were darkened so white button text stays at WCAG AA contrast.
- Learner feedback: the objective buttons often showed the same plan, and floating cards hid parts of the map. Objectives that agree now share one choice (every choice is a different plan; one plan is marked best for all goals when they agree), the camera fits the whole board into the free screen area, the live event feed moved behind a top-bar button and the colour key into the timeline, and portrait tablets use the bottom-sheet layout.
