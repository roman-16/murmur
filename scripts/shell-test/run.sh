#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/../.."

for tool in gjs gnome-shell; do
    if ! command -v "$tool" >/dev/null; then
        echo "error: $tool is required to drive the extension" >&2
        exit 1
    fi
done

tmp=$(mktemp --directory)
trap 'rm --recursive --force "$tmp" 2>/dev/null || true' EXIT INT TERM

export PROBE_RESULT="$tmp/result"

# Headless, because the checks are assertions rather than a picture: nothing has
# to be on screen, and a window nobody watches cannot be occluded by one that is.
export NESTED_HEADLESS=1
export NESTED_EXTENSIONS="scripts/shell-test/probe@murmur.local"
# The probe reaches the extension directly, so the session needs no working
# shortcut. Naming one nothing binds keeps the run from borrowing yours.
export RECORDING_SHORTCUT="<Super><Shift><Control><Alt>F12"

# gjs aborts when it loads typelibs from a different GLib than its own, which is
# what it does by default inside a devbox shell on a GNOME system. The probe
# opens a window with gjs, as a child of the shell, so this has to be set before
# the shell starts rather than around the call.
typelibs=$(cd "$(dirname "$(command -v gjs)")/../lib/girepository-1.0" 2>/dev/null && pwd || true)
if [ -n "$typelibs" ]; then
    export GI_TYPELIB_PATH="$typelibs${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
fi

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
