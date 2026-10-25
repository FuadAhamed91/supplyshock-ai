// Build the narration one sentence at a time.
//
// Synthesising per sentence keeps natural prosody (a sentence is the unit Kokoro
// reads well) while giving an exact duration for every sentence, so subtitles
// can be placed from arithmetic instead of from speech recognition — which
// mishears the product's own vocabulary.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../vo');
const ASSETS = path.join(VO, '../composition/assets/vo');
const PARTS = path.join(VO, 'parts');
const GAP = 0.22;            // breath between sentences
const SPEED = '1.08';       // a touch brisker than Kokoro's default read
const MAX_CHARS = 46;       // one subtitle line
fs.mkdirSync(PARTS, { recursive: true });

const script = JSON.parse(fs.readFileSync(path.join(VO, 'script.json'), 'utf8'));
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });

/** Split a sentence into subtitle-sized lines on word boundaries. */
function lines(text) {
  const words = text.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > MAX_CHARS) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}

const manifest = {};
for (const [id, text] of Object.entries(script.lines)) {
  const sentences = text.match(/[^.?!]+[.?!]+/g).map((s) => s.trim());
  const segs = [];
  sentences.forEach((sentence, i) => {
    const wav = path.join(PARTS, `${id}-${String(i).padStart(2, '0')}.wav`);
    const txt = path.join(PARTS, `${id}-${String(i).padStart(2, '0')}.txt`);
    fs.writeFileSync(txt, sentence, 'utf8');
    if (!fs.existsSync(wav)) {
      sh('npx', ['hyperframes', 'tts', txt, '--voice', script.voice, '--speed', SPEED, '--output', wav, '--json']);
    }
    // Kokoro pads each utterance with lead-in and lead-out silence. Left in,
    // eight sentences of padding adds up to seconds of dead air, so trim each
    // sentence to the speech itself and add back one deliberate breath.
    const trimmed = wav.replace(/\.wav$/, '-trim.wav');
    const TRIM = 'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-45dB:detection=peak';
    sh('ffmpeg', ['-v', 'error', '-y', '-i', `"${wav}"`, '-af', `"${TRIM},areverse,${TRIM},areverse"`, `"${trimmed}"`]);
    const dur = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `"${trimmed}"`]).trim());
    segs.push({ wav: trimmed, sentence, dur });
  });

  // Pad each sentence with a breath, then join.
  const padded = [];
  segs.forEach((s, i) => {
    const out = s.wav.replace(/\.wav$/, '-pad.wav');
    const pad = i === segs.length - 1 ? 0 : GAP;
    sh('ffmpeg', ['-v', 'error', '-y', '-i', `"${s.wav}"`, '-af', `apad=pad_dur=${pad}`, `"${out}"`]);
    padded.push(out);
  });
  const listFile = path.join(PARTS, `${id}-list.txt`);
  fs.writeFileSync(listFile, padded.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  fs.mkdirSync(ASSETS, { recursive: true });
  const sceneWav = path.join(ASSETS, `${id}.wav`);
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `"${listFile}"`, '-c', 'copy', `"${sceneWav}"`]);

  // Lay the subtitle cues over the known sentence boundaries.
  const cues = [];
  let t = 0;
  for (const s of segs) {
    const parts = lines(s.sentence);
    const chars = parts.reduce((a, p) => a + p.length, 0);
    let st = t;
    parts.forEach((p) => {
      const d = s.dur * (p.length / chars);
      cues.push({ start: +st.toFixed(3), end: +(st + d).toFixed(3), text: p });
      st += d;
    });
    t += s.dur + GAP;
  }
  const total = +(t - GAP).toFixed(3);
  manifest[id] = { duration: total, sentences: segs.length, cues };
  console.log(`${id}  ${total.toFixed(2)}s  ${segs.length} sentences  ${cues.length} cues`);
}

fs.writeFileSync(path.join(VO, 'cues.json'), JSON.stringify(manifest, null, 2));
const total = Object.values(manifest).reduce((a, m) => a + m.duration, 0);
console.log(`TOTAL narration: ${total.toFixed(2)}s`);
