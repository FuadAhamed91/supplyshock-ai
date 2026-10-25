# Hyperframes Composition Brief: SupplyShock AI

## Objective
A 2:30 narrated demo film for SupplyShock AI, built from real captured footage of the
running app, with burned-in subtitles and no music.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30 fps
- Duration: 150 s (explicit user requirement; overrides /brag's 15–25 s default)

## Source Material
- Project root: the repository root
- Primary files read: `index.html`, `src/styles.css`, `README.md`, `src/ui/app.js`,
  `src/data/network.js`, `src/sim/explain.js`, `src/scene/*`
- Product name: SupplyShock AI
- Strongest claim: "When one link breaks, who runs out first?"
- Key UI to show: the live 3D board, the disruption cards, the impact panel, the
  planner's strategy × future grid, the recommendation with its "Why not…?" line, the
  green recovery replay
- Copy that must appear verbatim:
  - "When one link breaks, who runs out first?"
  - "A hospital waits in 19 of 40 futures."

### Footage
Every shot is the real app, captured headless on the GPU at 1920x1080 with virtual time
stepped one frame at a time (`scripts/film.mjs`), and driven through the app's own API
(`window.__supplyshock`). The simulation clock is paced explicitly per scene. Every number
spoken or shown is read off that run (`composition/assets/footage/facts.json`):

| | Do nothing | With the plan |
|---|---|---|
| Late orders | 22 of 70 | 3 |
| Hospital orders late | 11 | 0 |
| Back to normal | 5.1 days | 4.7 days |
| Cost | $64k | $28k |

Plan: Backup supplier + Rebalance stock + Hospitals first — hospitals safe in 40 of 40
futures. Rejected alternative: Backup supplier + Rebalance stock — 0 late orders in the
expected week, but a hospital order late in 19 of 40 futures. 328 simulations (8
strategies × 40 futures + 8 expected weeks).

**One disclosed liberty:** the live search finishes in under a second, so the planner
scene replays the search's own per-future results into the real thinking panel at
reading speed. The narration says so ("Slowed down here, so you can watch it think") and
an on-screen tag reads "Real results · replayed at reading speed".

## Creative Direction
- Tone preset: `cinematic`
- Creative direction: incident documentary — one disruption, told in order
- Interpretation: calm authoritative narration, long holds on the board, big quiet type,
  every claim visible on screen as it is spoken
- Hook: the board at peace, and the unfinished sentence "A ship stuck outside a port on
  Monday…"
- Outro: "When one link breaks, who runs out first?"
- Avoid: generic SaaS language, abstract filler, any redesign of the product UI

## Visual Identity
- Background / overlays: graphite `#101520` (the app's rail)
- Text: `#ffffff` on graphite
- Accent: indigo `#4f46e5` (`#a5b4fc` on dark), success `#22c55e`, alarm `#e5484d`
- Font: Inter 400/700 (the app's own face), shipped locally as woff2

## Storyboard
See `brag-plan.md`. Cut list as rendered (`timeline.json`):

1. Cold open — 0.0–12.8 s — board at peace, push in; title on "…until it breaks."
2. The network — 12.8–27.1 s — normal week, Central Hub's stock card
3. Break a link — 27.1–42.0 s — the four disruptions, trigger, shockwave
4. The ripple — 42.0–64.1 s — impact panel, the week runs, hubs run dry
5. The planner — 64.1–94.1 s — 8 × 40 grid fills; "328 simulated weeks"
6. The plan — 94.1–120.1 s — recommendation; the rejected plan, 19 of 40
7. The recovery — 120.1–138.0 s — green replay; "11 → 0"
8. Close — 138.0–150.0 s — end card, the question, the URL

## Audio
- Audio role: voiceover only, intentional silence underneath
- Music: none (user requirement)
- Voice: Kokoro-82M `bm_george` at 1.08×, synthesised per sentence so every subtitle is
  placed from measured durations rather than speech recognition
- SFX: three quiet, warm, low-HF cues on the only three structural events — the trigger
  (`impactSoft_heavy_001`, 0.50), the grid completing (`bong_001`, 0.32), the plan applying
  (`impactSoft_medium_001`, 0.42)
- Restraint rule: nothing competes with the voice

## Subtitles
Burned in, bottom centre above the app's scrub bar, max two balanced lines, numbers
shown as numerals (the narration spells them out for pronunciation). The closing
question is set as the end card instead of a subtitle.

## Build
`node scripts/gen.mjs` regenerates `composition/index.html` from the measured narration;
`npx hyperframes check` is the gate (passes, 0 errors).
