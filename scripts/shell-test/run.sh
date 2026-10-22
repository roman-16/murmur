#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/../.."

for tool in bun gnome-shell; do
    if ! command -v "$tool" >/dev/null; then
        echo "error: $tool is required to drive the extension" >&2
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

export PROBE_RESULT="$tmp/result"
export PROBE_SENTENCE="Murmur heard every word of the call."

bun scripts/shell-test/mistral-mock.ts >"$tmp/mock.url" &
mock=$!
for _ in $(seq 40); do
    [ -s "$tmp/mock.url" ] && break
    sleep 0.25
done
if [ ! -s "$tmp/mock.url" ]; then
    echo "error: the stand-in transcription service did not start" >&2
    exit 1
fi
export MURMUR_SERVICE_URL
MURMUR_SERVICE_URL=$(head -1 "$tmp/mock.url")

export NESTED_HEADLESS=1
export NESTED_EXTENSIONS="scripts/shell-test/probe@murmur.local"
# The probe reaches the extension directly, so the session needs no working
# shortcut. Naming one nothing binds keeps the run from borrowing yours.
export DICTATION_SHORTCUT="<Super><Shift><Control><Alt>F12"
export RECORDING_SHORTCUT="<Super><Shift><Control><Alt>F11"

# A shell that dies badly still leaves the report behind, and that is the more
# useful thing to show, so the run's own status is not the answer here.
scripts/nested-shell.sh scripts/shell-test/session.sh || true

if [ ! -s "$PROBE_RESULT" ]; then
    echo "error: the probe never reported; the shell failed to start or the extension failed to load" >&2
    exit 1
fi

failures=$(head -1 "$PROBE_RESULT")
tail -1 "$PROBE_RESULT"
[ "$failures" = "0" ]
