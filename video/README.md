# The demo video, as a build

The submission video is generated, not screen-captured by hand: the voice track is synthesised,
the browser is driven through the live console on a schedule, and the two are cut together. It
is here so the video can be rebuilt when the site changes, rather than re-recorded by someone
dragging a mouse for three minutes and hoping.

Two videos come out of it. The **demo** walks the live console for the demo-video slot; the
**pitch** is the shorter one the submission form caps at two minutes, which is argument rather
than product, so it is mostly cards and drops to the live site twice to show the thing being
argued about is deployed.

```
# demo - 2:56
node video/build-audio.mjs
node video/record.mjs
./video/render.sh video/docket-demo.mp4

# pitch - 1:52
SCRIPT=pitch GAP_SAME=0.18 GAP_SCENE=0.42 TAIL=1.4 node video/build-audio.mjs
node video/pitch-record.mjs
SCRIPT=pitch ./video/render.sh video/docket-pitch.mp4
```

`SCRIPT` names the script and everything else follows it: `pitch.json` in, then
`pitch.timeline.json`, `audio-pitch/`, `pitch.ass`, `out-pitch/`. `LEAD`, `GAP_SAME`,
`GAP_SCENE` and `TAIL` tune the pacing, which is how the pitch fits a hard two-minute cap
without the lines being read any faster.

The order matters. **The picture is cut to the voice**, not the other way round:
`build-audio.mjs` measures every sentence and writes `timeline.json`, and `record.mjs`
schedules each camera move against those timings. Recording first would mean guessing how long
a sentence takes and being wrong on all thirty of them.

## The pieces

| file | what it is |
| --- | --- |
| `narration.json` | the script. `text` is the caption, `say` is what the voice reads |
| `build-audio.mjs` | runs piper per line, measures it, writes `voice.wav`, `timeline.json`, `subs.ass` |
| `overlay.js` | injected into the page: the cursor, the zoom, the intro and outro cards |
| `record.mjs` | the demo choreography — which element is pointed at, and when |
| `pitch.json`, `pitch-record.mjs` | the two-minute pitch: its script and its slides |
| `render.sh` | ffmpeg: video + voice + burned captions |

`say` and `text` differ wherever the written form is unspeakable. "ERC-8004" read literally is
not what anyone says out loud, and a caption reading "E.R.C. eight thousand and four" is not
what anyone wants to read.

## Prerequisites

ffmpeg, Playwright's Chromium, and [piper](https://github.com/OHF-Voice/piper1-gpl) with a
voice model in `voices/`:

```
pip install piper-tts
mkdir -p video/voices && cd video/voices
base=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high
curl -sSL -O $base/en_US-lessac-high.onnx -O $base/en_US-lessac-high.onnx.json
```

`PIPER_MODEL` overrides the voice, `PLAYWRIGHT_CHROMIUM_PATH` the browser, `TARGET` the site to
record (defaults to the deployed console).

## Three things that were not obvious

**The injected script runs before `<html>` exists.** At `document_start` both
`document.documentElement` and `document.head` are null, so building the overlay eagerly throws,
`window.__vid` never gets defined, and every later call is a silent no-op against `undefined` —
a recording where nothing happens and nothing errors. `overlay.js` builds lazily and every
method calls `ready()` first.

**Zoom is a CSS transform on live DOM**, so Chrome re-rasterises the text and it stays sharp.
Zooming in post would just be upscaled pixels. The transform goes on `<body>` and the cursor
lives on `<html>`, so the pointer is not scaled along with the page.

**Zoom is clamped to what keeps the subject in frame.** Scaling about an element's own centre
pushes everything to its right off screen; on a full-width dark panel that filled the shot with
a black slab, cream background gone and text running off the edge — nothing like the page the
link actually opens.

The page needs about twelve seconds to sync against a mandate this old, which is why the intro
card is opaque and covers the console while it loads. By the time it fades the history is there.
