/**
 * Narration -> voice track, timeline and subtitles.
 *
 * Run this before `record.mjs`, never after. The picture is cut to the voice: every camera
 * move in the recorder is scheduled against the timings this writes, so the audio has to exist
 * and be measured first. Doing it the other way round means guessing how long a sentence takes
 * and being wrong by a second on every one of them.
 *
 *   node video/build-audio.mjs
 *
 * Needs `piper` on PATH and a voice model (see video/README.md), plus ffmpeg/ffprobe.
 */
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const AUDIO = path.join(DIR, "audio");
const MODEL = process.env.PIPER_MODEL ?? path.join(DIR, "voices/en_US-lessac-high.onnx");

/** Leading silence, the gap inside a scene, the gap at a scene change, and the tail. */
const LEAD = 1.0;
const GAP_SAME = 0.2;
const GAP_SCENE = 0.5;
const TAIL = 1.6;

const script = JSON.parse(fs.readFileSync(path.join(DIR, "narration.json"), "utf8"));
fs.mkdirSync(AUDIO, {recursive: true});

const duration = (file) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
    ]).toString().trim(),
  );

// `say` is what the voice reads, `text` is what the subtitle shows. They differ wherever the
// written form is unspeakable: "ERC-8004" read literally is not what anyone says out loud.
for (const seg of script) {
  const wav = path.join(AUDIO, `${seg.id}.wav`);
  execFileSync("piper", ["-m", MODEL, "-f", wav, "--length-scale", "1.02",
                         "--sentence-silence", "0.26"], {input: seg.say});
  process.stdout.write(`${seg.id} `);
}
process.stdout.write("\n");

const segments = [];
let t = LEAD;
script.forEach((seg, i) => {
  const d = duration(path.join(AUDIO, `${seg.id}.wav`));
  segments.push({id: seg.id, scene: seg.scene, start: +t.toFixed(3), end: +(t + d).toFixed(3),
                 text: seg.text});
  t += d;
  if (i < script.length - 1) t += script[i + 1].scene !== seg.scene ? GAP_SCENE : GAP_SAME;
});
const total = +(t + TAIL).toFixed(3);
fs.writeFileSync(path.join(DIR, "timeline.json"), JSON.stringify({total, segments}, null, 1));

// Each clip is delayed to its own start and the lot mixed down, rather than concatenated with
// padding - the gaps are part of the timeline, so they belong in the timings, not in the files.
const inputs = segments.flatMap((s) => ["-i", path.join(AUDIO, `${s.id}.wav`)]);
const delays = segments
  .map((s, n) => `[${n}:a]adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)},apad[a${n}]`)
  .join(";");
const mix = segments.map((_, n) => `[a${n}]`).join("");
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex",
  `${delays};${mix}amix=inputs=${segments.length}:normalize=0:duration=longest[m];` +
  `[m]atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`,
  "-map", "[out]", "-c:a", "pcm_s16le", path.join(AUDIO, "voice.wav")]);

// ASS rather than SRT: libass defaults its own script resolution when the file does not say,
// so an SRT burned at 1080p came out with the captions roughly twice the size intended.
const stamp = (x) => {
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};
const wrap = (line) => {
  if (line.length <= 58) return line;
  const cut = line.lastIndexOf(" ", Math.ceil(line.length / 2) + 14);
  return `${line.slice(0, cut)}\\N${line.slice(cut + 1)}`;
};
const PREROLL = Number(process.env.PREROLL ?? 1.5);
const ass = [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080",
  "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour," +
    " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline," +
    " Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Sub,Inter,41,&H00FFFFFF,&H000000FF,&H00000000,&HA8101010,0,0,0,0,100,100,0.4,0,3,9,0," +
    "2,120,120,62,1", "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];
segments.forEach((s, n) => {
  const next = segments[n + 1] ? segments[n + 1].start : s.end + 1;
  const end = Math.max(s.end, Math.min(s.end + 0.3, next - 0.08));
  ass.push(`Dialogue: 0,${stamp(s.start + PREROLL)},${stamp(end + PREROLL)},Sub,,0,0,0,,` +
           wrap(s.text.replace(/—/g, "-")));
});
fs.writeFileSync(path.join(DIR, "subs.ass"), `${ass.join("\n")}\n`);

const mmss = `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
console.log(`${segments.length} segments, ${total}s (${mmss}) -> audio/voice.wav, timeline.json, subs.ass`);
