#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

capture=${DEMO_CAPTURE:?DEMO_CAPTURE is unset}
done_file=${DEMO_DONE_FILE:?DEMO_DONE_FILE is unset}
candidates=(org.gnome.TextEditor org.gnome.gedit org.gnome.Console org.gnome.Ptyxis org.gnome.Terminal)

# Only what the nested session can reach: its own data directory is a fresh
# temporary one, so anything installed for this user alone is not there.
system_dirs() {
    printf '%s' "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" | tr ':' '\n'
}

first_installed() {
    local id dir
    for id in "$@"; do
        while read -r dir; do
            if [ -f "$dir/applications/$id.desktop" ]; then
                printf '%s\n' "$id"
                return
            fi
        done < <(system_dirs)
    done
}

app_id=${DEMO_APP_ID:-$(first_installed "${candidates[@]}")}
if [ -z "$app_id" ]; then
    echo "error: none of ${candidates[*]} is installed; set DEMO_APP_ID to an app you have" >&2
    exit 1
fi

gsettings set org.gnome.desktop.interface color-scheme prefer-dark
# Transitions never advance in the development kit, which would leave the
# overlay stuck at the opacity its fade-in starts from.
gsettings set org.gnome.desktop.interface enable-animations false

# Launched over D-Bus so it opens in the nested session rather than the host
# one, which is also why the application has to be D-Bus activatable.
if ! gapplication launch "$app_id"; then
    echo "error: could not launch $app_id in the nested session" >&2
    exit 1
fi
sleep 1

# gjs aborts when it loads typelibs from a different GLib than its own, which is
# what it does by default inside a devbox shell on a GNOME system.
typelibs=$(cd "$(dirname "$(command -v gjs)")/../lib/girepository-1.0" 2>/dev/null && pwd || true)
if [ -n "$typelibs" ]; then
    export GI_TYPELIB_PATH="$typelibs${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
fi

gjs -m scripts/demo/screencast.js "$capture" "$done_file"
sleep 1

if [ ! -f "$done_file" ]; then
    echo "error: the demo driver never finished its take" >&2
    exit 1
fi
