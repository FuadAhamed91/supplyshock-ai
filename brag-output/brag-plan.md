# Brag Plan: SupplyShock AI

> **Deviation from the skill default, on explicit user instruction:** `/brag` normally
> caps at 15–25 seconds. The user asked for a **2:30 demo film** with voiceover and
> burned-in subtitles and **no music**. Duration, scene count and pacing below follow
> the user's brief, not the default creative law.

## What is this app?

SupplyShock AI is a disruption simulator for medical-supply distributors: break one link
of a supply chain on a live 3D model of your network, watch the shock ripple out to
hospitals hour by hour, then let a simulation-based AI planner rehearse every recovery
option across 40 randomised futures and recommend the one that keeps patients supplied.

## The angle

**Make the invisible chain visible, then break it on camera.**

The whole pitch of this product is a causal chain nobody can normally see: a ship stops →
a hub runs dry → a hospital waits. Every other supply-chain tool shows that as a
spreadsheet. This one shows it as a city you can watch it happen to. So the film is not a
feature tour — it is one continuous incident, told in order: the normal week, the break,
the ripple, the search, the plan, the recovery. The product demonstrates itself.

The thing that earns the win is the planner sequence: a grid of 8 strategies × 40 futures
filling in green and red in real time. That is a visual nobody else at a hackathon will
have, and it is the honest picture of what the software actually does.

## Hook (first 2–3 seconds)

Silence, then a slow push across the board running normally — trucks moving, a ship
berthing — while a single line lands: **"A ship stuck outside a port on Monday…"**. The
sentence is deliberately unfinished. The viewer waits for the other half.

## Key moments (the middle)

- The four disruption cards, then **Trigger port congestion** — the clock stops, a red
  shockwave rolls out from the terminal and every dependent route turns red.
- The ripple chain in plain English: *Day 4, Central Hub runs out of insulin. Day 5,
  St. Clara Hospital gets a late order.*
- **The planner grid** — 8 rows, 40 squares each, filling green and red, live. The
  centrepiece.
- The recommendation with before → after and **"every hospital order on time in 40 of 40
  futures"**.
- The **"Why not…?"** line — the planner naming the tempting alternative and rejecting it
  because a hospital waits in 19 futures. This is the credibility moment.
- The replay: green trucks carrying the plan, hub stock holding, hospital labels staying
  on schedule.

## Outro / punchline

Back to the wide board, calm again. The product's own question as the closing line:
**"When one link breaks, who runs out first?"**

## User flow worth showing

Entry → key action → result, exactly as a real user does it, and all of it captured from
the running app:

1. **Entry** — a normal week playing on the 3D board; click a building to see its stock.
2. **Key action** — pick a disruption, set its length, trigger it; watch the ripple and read
   the impact; run the AI planner.
3. **Result** — apply the recommended plan and watch the week replay with the recovery in
   green, tracked live against doing nothing.

## Tone

- Preset: `cinematic`
- Creative direction: **incident documentary** — a calm, authoritative narrator walking
  through one disruption as it happens. Confident, never hyped; the drama comes from the
  stakes and the motion, not from adjectives.
- Interpretation: long-ish holds on the board, big quiet type, hard-earned claims backed by
  numbers on screen. No whooshes, no hype words, no stock-video energy. Every claim the
  narrator makes is visible on screen at the moment it is made.

## Format: landscape — 1920x1080
## Duration: 150s (2:30), hard requirement

## Visual identity (from the project)

- Background: `#e8eef6` (app `--bg`); film letterbox/cards use the rail graphite `#101520`
- Accent: `#4f46e5` (brand indigo)
- Success / AI: `#16a34a`
- Alarm: `#e5484d`
- Warning: `#f59e0b`
- Text: `#0d1521` on light, `#ffffff` on graphite
- Display + body font: **Inter** (400/500/600/700) — the app's own face
- Strongest visual element: the 3D diorama board itself, with the red shockwave and the
  green AI recovery routes

## Share copy (draft)

Break one link of a supply chain on a live 3D map, watch the shock reach the hospitals,
then let an AI planner rehearse 300+ recoveries across 40 possible futures and tell you
which one keeps every patient supplied.

## Audio direction

- Role: **voiceover only — intentional silence underneath** (user requirement: no music)
- Music: **none** — explicitly disabled by the user. Do not add a bed.
- Music treatment: n/a
- Music cue guidance: n/a — no music, so no beat sync. Pacing is cut to the narration.
- Audio-reactive treatment: none
- SFX posture: **very sparse** — the narration carries the film. At most a handful of dry,
  quiet cues on the three structural beats (the trigger, the planner finishing, the plan
  applying), at low volume, and only where they match a real on-screen event. Silence is
  the default; if a cue does not clearly help, leave it out.
- Audio-coupled moments: the disruption trigger (one soft impact), the planner grid
  completing (one soft bell), the plan being applied (one soft confirm).
- Restraint rule: **nothing may compete with the voice.** No music, no risers, no whooshes,
  no sound under dialogue except the three cues above. If in doubt, silence.

## Voiceover

- Engine: `hyperframes tts` (local Kokoro-82M), one WAV per scene so each scene's length is
  cut to its narration.
- Voice: a calm, credible documentary read (candidate: `bm_george`; audition against
  `am_michael` and `bf_emma` and pick the most authoritative).
- Writing rule: the narration never reads the text on screen. It says the thing the
  picture cannot.

## Subtitles

Burned in, bottom-centre, above the safe margin. Word-level timings from
`hyperframes transcribe` on the generated VO so they track the voice exactly. Two lines
maximum, ~7 words per line, graphite pill behind the text for legibility over the bright
board.

## Storyboard

> The narration lines in this storyboard are first drafts written before the footage was
> captured. The recorded script, with every number read off the captured run, is in
> **Voiceover script (as recorded)** at the end of this file.

Durations are targets; each scene is trimmed to its actual narration length during
assembly, holding the total at 150s.

### Scene 1 — Cold open — 13s
Wide board, normal week, slow push in. Title card resolves: **SupplyShock AI**.
VO: "A ship stuck outside a port on Monday can leave a hospital without insulin by
Wednesday. The chain between those two facts is invisible — until it breaks."
Sequential/interaction: none — one continuous camera move.
Audio intent: open in silence; let the first sentence land alone.
Audio-coupled idea: none.
Music: none.
Transition mood: soft → Scene 2

### Scene 2 — The problem — 16s
The normal week running: trucks on the roads, a ship berthing, stock bars on the hub
labels. Click a hub to open the inspector showing days of cover.
VO: "Large distributors run planning suites that model this. Everyone else finds out when
a customer calls about a delivery that never arrived. This is a regional medical-supply
network, running a normal week."
Sequential/interaction: yes — simulate a click on Central Hub; the inspector card opens.
Audio intent: calm, procedural.
Audio-coupled idea: none (the click is visible, not heard).
Transition mood: clean → Scene 3

### Scene 3 — Break a link — 20s
The four disruption cards in the panel. Cursor picks Port congestion, drags the duration
slider to 4 days, presses **Trigger**. The clock stops; a red shockwave rolls out of the
terminal; routes turn red; the beacon pins over the port.
VO: "Break one link. Close the port, shut a hub, close a bridge, or cut a supplier. Choose
how long it lasts — and watch it hit."
Sequential/interaction: yes — card select, slider drag, button press, then the ripple.
Audio intent: one dry impact as the shockwave leaves the terminal.
Audio-coupled idea: single soft impact cue at the trigger.
Transition mood: hard → Scene 4

### Scene 4 — The ripple — 25s
The impact panel: late orders, hospital orders late, time to recover, cost. Then the week
plays at speed — hub labels turn amber then red, the overdue chart climbs.
VO: "Now the consequences, hour by hour. Day four, Central Hub runs out of insulin. Day
five, St. Clara Hospital gets a late order. Ten orders late. Six of them for hospitals.
Four and a half days to recover. Thirty-three thousand dollars."
Sequential/interaction: yes — the ripple-chain rows arrive one by one; the clock runs.
Audio intent: tension through silence and motion, not sound.
Audio-coupled idea: none.
Transition mood: dramatic → Scene 5

### Scene 5 — The planner — 30s
**The centrepiece.** The thinking panel: progress bar, strategy name ticking over, and the
grid of 8 × 40 squares filling green and red, live.
VO: "Then the planner goes to work. This is not a chatbot — it is a simulation-based
planning agent. It takes every combination of four recovery levers and plays each one out
across forty randomised futures, where demand, travel times and the disruption's real
length all vary. One row per strategy. One square per future. Green means every hospital
order arrived on time. Six hundred simulations, under a second, in your browser."
Sequential/interaction: yes — the grid fills row by row, square by square.
Audio intent: hold silence while the grid fills, then one soft bell as it completes.
Audio-coupled idea: single soft bell on completion.
Transition mood: clean → Scene 6

### Scene 6 — The plan — 24s
The recommendation card: title, "Best for" chips, the reason, the concrete steps, the
before → after rows, the confidence bar. Then scroll to the **"Why not…?"** line.
VO: "It recommends a plan, and it shows its work. Ten late orders become zero. Six
hospital orders late become none. Thirty-three thousand dollars becomes twenty-one. Every
hospital order on time, in forty of forty futures. And when a cheaper plan looks better on
paper, it says so — fewer late orders in the expected week, but a hospital waits in
nineteen futures out of forty."
Sequential/interaction: yes — before/after rows arrive one by one; panel scrolls to the
"Why not" callout.
Audio intent: confident, settled.
Audio-coupled idea: none.
Transition mood: clean → Scene 7

### Scene 7 — Watch it recover — 20s
Apply the plan. The week replays from the moment of the disruption with green trucks and
green routes; the live counter tracks plan vs do-nothing; hospital labels stay on
schedule.
VO: "Apply it, and the week replays from the moment the disruption hit. Green is the plan
in action. The hubs hold. The hospitals stay on schedule. And it keeps score against doing
nothing, hour by hour."
Sequential/interaction: yes — green ripple out, trucks moving, counter updating.
Audio intent: one soft confirm as the plan applies, then silence.
Audio-coupled idea: single soft confirm cue at apply.
Transition mood: soft → Scene 8

### Scene 8 — Close — 12s
Pull back to the whole board, calm. Report and share buttons. Final card: the mark, the
product name, the question, the URL.
VO: "Download the report, or copy the summary. No server, no API keys — all of it runs in
the browser. When one link breaks, who runs out first?"
Sequential/interaction: none.
Audio intent: let the last line sit in silence before the card.
Audio-coupled idea: none.
Transition mood: soft fade to the end card.

**Music mood for this video:** none — voiceover only, by explicit user requirement.
**Audio summary:** A calm documentary narration over an otherwise silent film, with three
quiet, motion-matched cues on the only three structural beats (trigger, planner complete,
plan applied); nothing ever competes with the voice.

## Total: 13 + 16 + 20 + 25 + 30 + 24 + 20 + 12 = 160s target, trimmed to 150s on assembly.

## Voiceover script (as recorded)

Voice: Kokoro-82M `bm_george` at 1.08×, synthesised one sentence at a time. The spoken
script (`vo/script.json`) spells numbers out for pronunciation; subtitles show numerals.
Every figure comes from the captured run (`composition/assets/footage/facts.json`).

**1. Cold open** — A ship stuck outside a port on Monday can leave a hospital without
insulin by Wednesday. The chain between those two facts is invisible, until it breaks.

**2. The network** — Large distributors run planning suites that model this. Everyone else
finds out when a customer calls about a delivery that never arrived. This is a regional
medical-supply network, running an ordinary week.

**3. Break a link** — So break one link. Close the port, shut a hub, close a bridge, or cut
a supplier. Choose how long it lasts, and watch it hit. The clock stops, the shock spreads
out from the terminal, and every route that depended on it turns red.

**4. The ripple** — Then it tells you what doing nothing costs. 22 orders late, out of 70.
11 of them for hospitals. 5 days to recover. $64,000. And it names the casualties in order.
Day 2: Central Hub runs out of insulin. Day 3: St. Clara Hospital gets a late order.

**5. The planner** — Now the planner goes to work. This is not a chatbot. It is a
simulation-based planning agent. It takes every combination of 4 recovery levers, and
plays each one out across 40 randomised futures, where demand, travel times, and the
disruption's real length all vary. Green means every hospital order arrived on time. 328
simulations, in under a second, in your browser. Slowed down here, so you can watch it think.

**6. The plan** — Then it picks one, and it shows its work. 22 late orders become 3. 11 late
hospital orders become none. $64,000 becomes $28,000. And here is the part that matters.
Another plan had zero late orders in the expected week, better than the one it chose. It
rejected it anyway, because in 19 of 40 futures, a hospital waits.

**7. The recovery** — Apply it, and the week replays from the moment the disruption hit.
Green is the plan in action. Rush orders and spare stock, moving to where they're needed.
The hubs hold, the hospitals stay on schedule, and it keeps score against doing nothing,
hour by hour.

**8. Close** — No server. No API keys. One browser tab, and an answer to the only question
that matters. When one link breaks, who runs out first?
