#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

crop_top=${DEMO_CROP_TOP:-32}
fps=${DEMO_FPS:-20}
quality=${DEMO_WEBP_QUALITY:-90}
webp_width=${DEMO_WEBP_WIDTH:-1280}

export DEMO_FRAMERATE=${DEMO_FRAMERATE:-30}
if [ "${DEMO_PIPELINE:-}" = default ]; then
    unset DEMO_PIPELINE
else
    export DEMO_PIPELINE=${DEMO_PIPELINE:-"capsfilter caps=video/x-raw,max-framerate=%F/1 ! \
videoconvert chroma-mode=none dither=none matrix-mode=output-only n-threads=%T ! \
queue ! \
vp8enc cpu-used=4 min-quantizer=0 max-quantizer=8 deadline=1 threads=%T keyframe-max-dist=%F ! \
queue ! \
webmmux"}
fi

for tool in bun ffmpeg gapplication gjs gnome-shell; do
    if ! command -v "$tool" >/dev/null; then
        echo "error: $tool is required to record the demo" >&2
        exit 1
    fi
done

tmp=$(mktemp --directory)
mock=""
cleanup() {
    [ -z "$mock" ] || kill "$mock" 2>/dev/null || true
    rm --recursive --force "$tmp" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bun scripts/demo/grok-mock.ts >"$tmp/mock.url" &
mock=$!
for _ in $(seq 40); do
    [ -s "$tmp/mock.url" ] && break
    sleep 0.25
done
if [ ! -s "$tmp/mock.url" ]; then
    echo "error: the mock transcription server did not start" >&2
    exit 1
fi

export MURMUR_SERVICE_URL
MURMUR_SERVICE_URL=$(head -1 "$tmp/mock.url")
export XAI_API_KEY=${XAI_API_KEY:-demo}
export MURMUR_PROVIDER=xai

export DEMO_CAPTURE="$tmp/demo"
export DEMO_DONE_FILE="$tmp/done"
export DEMO_RECORDING_FILE="$DEMO_CAPTURE.recording"
export NESTED_EXTENSIONS="scripts/demo/driver@murmur.local"
export NESTED_HEADLESS=1 NESTED_SCREENS=1
export DICTATION_SHORTCUT=${DEMO_SHORTCUT:-<Super>space}

scripts/nested-shell.sh scripts/demo/session.sh

capture=$(cat "$DEMO_CAPTURE.path" 2>/dev/null || true)
if [ -z "$capture" ] || [ ! -s "$capture" ]; then
    echo "error: no recording was produced" >&2
    exit 1
fi

mkdir --parents assets
crop="crop=in_w:in_h-$crop_top:0:$crop_top"

ffmpeg -loglevel error -y -i "$capture" \
    -vf "$crop,fps=$fps,scale=$webp_width:-2:flags=lanczos" \
    -c:v libwebp_anim -lossless 0 -q:v "$quality" -compression_level 6 -loop 0 \
    -an assets/demo.webp

echo "wrote assets/demo.webp"
