#!/usr/bin/env bash
# Mux the recording with the voice track and burn the captions.
#
#   ./video/render.sh [out.mp4]
#
# CRF 23 rather than 18: screen text survives it intact and it is the difference between a
# 20 MB file and a 33 MB one, which matters when the thing has to be uploaded somewhere.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="${SCRIPT:-narration}"
out="${1:-$here/docket-$name.mp4}"

src=$(ls -t "$here"/out-"$name"/*.webm 2>/dev/null | head -1)
[ -n "$src" ] || { echo "no recording in $here/out-$name - run record.mjs first" >&2; exit 1; }

preroll=$(node -e "process.stdout.write(String(require('$here/$name.preroll.json').preroll))")
total=$(node -e "process.stdout.write(String(require('$here/$name.timeline.json').total + $preroll))")

# pan= rather than -ac 2: the default mono-to-stereo matrix attenuates by 3 dB, which quietly
# undid the loudnorm the voice track was mastered with.
ffmpeg -v error -stats -y -i "$src" -itsoffset "$preroll" -i "$here/audio-$name/voice.wav" \
  -map 0:v:0 -map 1:a:0 -t "$total" \
  -vf "ass=$here/$name.ass" \
  -c:v libx264 -preset slower -crf 23 -pix_fmt yuv420p -profile:v high -level 4.1 \
  -af "pan=stereo|c0=c0|c1=c0" -c:a aac -b:a 128k -ar 48000 \
  -movflags +faststart "$out"

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$out"
