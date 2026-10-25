---
doc: scope
status: draft
---

# SupplyShock AI

A disruption simulator: break one link of a supply chain on a live 3D map, see how the shock ripples through the whole business, and get an AI-recommended recovery plan.

## The Unique Kernel
"See how one supply-chain disruption affects an entire business" — not as a dashboard of numbers, but as a living 3D model where trucks stop, stock piles shrink and customers turn red, followed by an AI that rehearses every recovery option across many possible futures before recommending one.

## Who It's For
Planners at small and mid-sized distributors (the demo is a regional medical-supply distributor serving hospitals, clinics, a pharmacy and a care home). Today they find out about a disruption's knock-on effects when a customer calls about a missing delivery; enterprise planning suites that model this are built for much larger companies.

## The Core Loop
Pick a disruption (or click a building) → watch the ripple: which hubs run dry, which orders go late, what it costs → ask the AI for recovery plans → apply one and watch the network recover → download the report → try the next "what if".

## Inspiration & Identity
- The learner's own idea card ("6. SupplyShock AI") and two reference mock-ups of a 3D logistics city with glowing routes, a port with a container ship, scenario cards, an AI-recommendation panel and a final report.
- Learner direction: **white UI**, polished, "don't make it look like a generic AI app", simple enough that people understand it, nothing bloated. Use the references only for what genuinely helps; **do not reuse the place names/labels from the reference images**.
- Interactive 3D built with **Three.js** and **Blender**: trucks moving, stock being taken, ships in the harbour.

## Why This Matters to the Learner
"This is software that will make the life of people easier." The learner wants a polished, convincing proof of concept for the Build With AI: Basics hackathon.

## What "Working" Looks Like
Open the app → a calm 3D network runs normally → trigger "Port congestion" → the incoming ship is stuck at anchor, red routes spread from the port, hubs run out of insulin and hospital orders go late → "Find recovery plans with AI" → the planner tests every combination of levers across simulated futures and recommends one with a confidence figure → apply it → green trucks appear and hospital orders stay on time.

The "oh, that's cool" beat: watching the ship held offshore while the red ripple reaches the hospitals, then the green recovery trucks fixing it.

## The POC Boundary
- One fictional demo network: 1 port, 3 hubs, 1 backup supplier, 5 customers, 3 products.
- Four disruptions: port congestion, hub shutdown, bridge closure, supplier outage (with duration, and hub choice).
- Impact analysis, AI recovery planner (four levers), plan comparison, live recovery playback, printable report.
- Runs entirely in the browser.

## Later
- Import a company's own network (CSV of sites, routes and demand).
- Multiple simultaneous disruptions; longer horizons.
- An LLM-written narrative on top of the planner's numbers.

## Explicitly Cut
- Accounts, saving scenarios, multi-user collaboration — not needed to prove the kernel.
- Real-world maps and live data feeds — fictional data keeps the demo clear and avoids implying real operations.
- Night-time "neon" visual style from the references — the learner asked for a white UI.
