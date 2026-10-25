---
doc: prd
status: draft
---

# SupplyShock AI — Product Requirements

A browser app for planners at small distributors to rehearse supply-chain disruptions on a 3D model of their network and get an AI recovery plan. Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`.

## The Core Journey
1. **Arrive.** A short intro explains the problem ("When one link breaks, who runs out first?") and the three steps. Start or explore.
2. **Normal week.** The 3D network runs: a ship sails into Bayport Terminal, trucks carry stock to hubs and on to hospitals, crate piles at each hub rise and fall, routes glow blue. Live KPIs sit in the top bar; the event feed opens from the top bar, so the whole board stays in view.
3. **Break it.** Choose a disruption card (port congestion, hub shutdown, bridge closure, supplier outage), set how long it lasts, and trigger it — or click a building and use "Simulate a shutdown here".
4. **See the ripple.** The clock pauses. The camera flies to the disruption, a shockwave spreads, affected routes turn red and affected sites flash. The panel shows the do-nothing outcome: late orders, hospital orders late, time to recover, cost, the chain of consequences with times, and an "orders overdue" chart.
5. **Recover with AI.** The planner animates while it simulates every combination of recovery levers across 40 possible futures. It recommends a plan with concrete steps, a one-line reason, before → after results with % change, and how often every hospital order stays on time. Each goal (Balanced, Cheapest, Fastest, Greenest) gets its best plan; goals that agree share one choice, so every choice shown is a different plan. The user can compare all strategies or pick another plan.
6. **Watch the recovery.** Applying the plan replays the week at 3× from the moment the disruption hits: green trucks and green routes show the plan's moves; the panel tracks live progress against the do-nothing case.
7. **Report.** Download a printable report (PDF via the browser) or copy a plain-text summary; start a new test.

Success: a first-time viewer understands what went wrong, who it hurt and why the recommended plan is better — within a minute.

## Screens and Layout
One screen. Full-bleed 3D map; floating white cards on top:
- **Top bar:** brand, status pill, four live KPIs (orders on time, hospital orders late, trucks on the road, stock on hand), help, camera reset, reset.
- **Left panel:** the guided four-step flow (stepper at the top).
- **Live events:** a card opened from the top bar (a dot marks new disruption or AI events); the route colour key sits at the right end of the timeline bar.
- **Map framing:** the camera fits the whole board into the space the cards leave free; phones and portrait tablets use a bottom sheet for the panel.
- **Bottom bar:** play/pause, speed (1×/3×/8×), clock, scrubbable week timeline with disruption band, ship arrivals, stockouts and plan marker.
- **Inspector card** (on click): site details and, for the port and hubs, a one-click disruption.
- **Intro overlay** on load.

## Look and Feel
White, light "architectural model" diorama; Inter typography; indigo as the brand accent; status colours with fixed meaning: blue/indigo = normal flow, green = AI recovery, amber = at risk, red = disrupted/late. Calm, spacious, minimal text. Ships, cranes, warehouses, trucks and hospitals are Blender-built low-poly models. Learner direction: white UI, polished, not generic AI styling, simple, colours free to choose.

## Features and Behavior

### Live network
- Trucks move along real roads, carrying the stock the simulation dispatched; waiting trucks show a clock badge.
- Hub crate piles and the port's container yard grow and shrink with stock; labels show days of stock and status.
- A container ship arrives every two days; held ships wait at anchor, and more ships queue offshore during port congestion.
- Clicking a site opens its details.

### Disruptions
- Four types, each with a duration slider; hub shutdown also picks the hub.
- Triggering pauses the clock and plays the ripple animation.
- Acceptance: triggering port congestion early on Day 1 holds the incoming ship and produces late hospital orders in the do-nothing case.

### AI recovery planner
- Levers: rush order from the backup supplier, rebalance stock between hubs, reroute around the disruption, serve hospitals first (only levers that make sense for the disruption are tried).
- Every combination is simulated in an expected case plus 40 randomized futures; plans are ranked with late hospital orders always weighted highest, then by the chosen objective.
- Output: recommended plan, concrete steps (units, batches, transfers, reassignments), reason, before → after results, confidence, full comparison.
- Robustness first: when a plan with fewer expected late orders is passed over because it leaves hospitals exposed in some futures, the panel says so ("Why not …?"). Near-ties go to the simpler plan.

### Recovery playback and report
- Applying a plan replays the week with the plan in effect from the moment the disruption hits (if the user watched the do-nothing playback first, the clock rewinds).
- Report: what happened, impact, plan, comparison, recommendations, method.

## States and Boundaries
- **First use** — intro overlay; clock paused until dismissed. "Start a stress test" keeps it paused at Day 1 06:00 while the test is set up.
- **Normal** — week loops forever.
- **Disruption chosen** — clock paused for analysis; can "watch it unfold" with no plan.
- **Planning** — clock locked until a plan is applied.
- **Recovery** — clock runs; ends paused at the end of the horizon.
- **Persistence** — none; reload resets.

## Product Decisions
- Idea, kernel and MVP shape (simulate a disruption; AI recommends redistribution and which orders to prioritize; compare recovery strategies) — learner's idea card.
- White UI, polished, simple, not bloated, not generic-AI looking — learner.
- Three.js + Blender with moving trucks and stock — learner.
- Use reference images selectively; don't reuse their labels — learner.
- Ships in the harbour; explain the problem in the UI; free choice of colours — learner.
- Healthcare distributor as the demo business; fictional names; four disruption types; Balanced/Cheapest/Fastest/Greenest objectives — **agent proposal**, chosen to make impact easy to understand (hospitals waiting on insulin).

## What We're Building
Everything in The Core Journey, for the one demo network, in the browser.

## Deferred From the POC
- Uploading a company's own network — needs import, validation and editing UI.
- Saving and sharing scenarios — needs storage/accounts.

## Possible Later Enhancements
LLM-written narrative of the plan; multiple simultaneous disruptions; cost and CO₂ sliders; real map tiles.

## Non-Goals
- Not a live control tower connected to real systems.
- Not a full optimizer for every SKU/route; the planner searches a small, explainable set of levers.

## Open Questions
- Learner to confirm the demo domain (medical supplies) and names before submission — can wait.
