#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

uuid="murmur@roman-16.github.io"
payload=${1:-}
[ -z "$payload" ] || payload=$(realpath "$payload")
shortcut=${RECORDING_SHORTCUT:-<Super>j}

# A devbox shell trims XDG_DATA_DIRS to its own profile, which leaves the nested
# session unable to find, or D-Bus activate, any installed application. Take the
# desktop session's own value instead.
session_data_dirs() {
    local pid
    pid=$(pgrep --newest --uid "$(id --user)" gnome-shell 2>/dev/null) || return 0
    tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | sed --quiet 's/^XDG_DATA_DIRS=//p' | head -1
}

inherited=$(session_data_dirs)
export XDG_DATA_DIRS="${inherited:-${XDG_DATA_DIRS:-/usr/local/share:/usr/share}}"

data_dirs() {
    printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}"
    printf '%s' "$XDG_DATA_DIRS" | tr ':' '\n'
}

# Found by looking rather than by parsing `gnome-extensions info`, whose labels
# are translated.
installed_schemas() {
    local dir
    while read -r dir; do
        if [ -d "$dir/gnome-shell/extensions/$uuid/schemas" ]; then
            printf '%s\n' "$dir/gnome-shell/extensions/$uuid/schemas"
            return
        fi
    done < <(data_dirs)
}

settings() {
    local dir=$1
    shift
    if [ -n "$dir" ]; then
        GSETTINGS_SCHEMA_DIR="$dir" gsettings "$@"
    else
        gsettings "$@"
    fi
}

released=()

# A key combination belongs to one compositor, and this session matches it
# before the nested one ever sees the press.
release() {
    local schema=$1 key=$2 dir=${3:-} current
    current=$(settings "$dir" get "$schema" "$key" 2>/dev/null) || return 0
    [[ $current == *"'$shortcut'"* ]] || return 0

    released+=("$schema|$key|$dir|$current")
    settings "$dir" set "$schema" "$key" '[]'
    echo "lent $shortcut to the nested session ($schema $key)"
}

restore() {
    local entry schema key dir value
    for entry in "${released[@]:-}"; do
        [ -n "$entry" ] || continue
        IFS='|' read -r schema key dir value <<<"$entry"
        settings "$dir" set "$schema" "$key" "$value"
    done
}

release org.gnome.desktop.wm.keybindings switch-input-source
release org.gnome.desktop.wm.keybindings switch-input-source-backward
schemas=$(installed_schemas)
if [ -n "$schemas" ]; then
    release org.gnome.shell.extensions.murmur toggle-recording "$schemas"
fi

# Headless has no window to occlude, and a compositor whose window is covered
# stops painting, which a recording would capture as frozen frames. It gets two
# screens, because a rule that places chrome on the screen being worked on and
# one that always answers "the primary" are the same rule on a single monitor.
if [ -n "${NESTED_HEADLESS:-}" ]; then
    size=${NESTED_SIZE:-1280x800}
    nested="gnome-shell --headless --virtual-monitor $size --virtual-monitor $size"
elif gnome-shell --help-all 2>/dev/null | grep --quiet -- '--devkit'; then
    # The development kit replaced the nested mode in GNOME 49 and sizes its
    # own screen; the nested mode takes the size from the environment.
    nested="gnome-shell --devkit"
else
    nested="gnome-shell --nested"
    export MUTTER_DEBUG_DUMMY_MODE_SPECS=${NESTED_SIZE:-1280x800}
fi

tmp=$(mktemp --directory)
# Tolerant of a failed removal: the session's own services can still be writing
# into the directory as it goes away, and that must not become the exit status.
trap 'restore; rm --recursive --force "$tmp" 2>/dev/null || true' EXIT INT TERM

# The desktop session runs ibus and tells its clients so; this one does not run
# anything. A GTK client that cannot reach the input method it was pointed at
# never enables the Wayland text-input protocol, so the compositor sees no text
# field anywhere and Murmur believes there is nowhere to type. Unset, GTK speaks
# text-input to the nested compositor directly.
unset GTK_IM_MODULE QT_IM_MODULE QT_IM_MODULES XMODIFIERS

export XDG_CACHE_HOME="$tmp/cache" XDG_CONFIG_HOME="$tmp/config" XDG_DATA_HOME="$tmp/data" \
    XDG_STATE_HOME="$tmp/state"
extensions="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir --parents "$extensions"
ln --symbolic --force --no-dereference --no-target-directory "$PWD/dist" "$extensions/$uuid"
export GSETTINGS_SCHEMA_DIR="$extensions/$uuid/schemas"

uuid_of() {
    sed --quiet 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/metadata.json" | head -1
}

enabled="'$uuid'"
for extra in ${NESTED_EXTENSIONS:-}; do
    extra=$(realpath "$extra")
    extra_uuid=$(uuid_of "$extra")
    ln --symbolic --force --no-dereference --no-target-directory "$extra" "$extensions/$extra_uuid"
    enabled="$enabled, '$extra_uuid'"
done

cat >"$tmp/session.sh" <<EOF
set -euo pipefail

gsettings set org.gnome.shell enabled-extensions "[$enabled]"
gsettings set org.gnome.shell disable-user-extensions false
# A fresh profile is a first login, whose welcome dialog would take the modal
# and with it every shortcut.
gsettings set org.gnome.shell welcome-dialog-last-shown-version '99.0'
gsettings set org.gnome.shell.extensions.murmur toggle-recording "['$shortcut']"
if [ -n "\${MISTRAL_API_KEY:-}" ]; then
    gsettings set org.gnome.shell.extensions.murmur mistral-api-key "\$MISTRAL_API_KEY"
fi
if [ -n "\${GEMINI_API_KEY:-}" ]; then
    gsettings set org.gnome.shell.extensions.murmur gemini-api-key "\$GEMINI_API_KEY"
fi
if [ -n "\${MURMUR_PROVIDER:-}" ]; then
    gsettings set org.gnome.shell.extensions.murmur transcription-provider "\$MURMUR_PROVIDER"
fi

if [ -z '$payload' ]; then
    exec $nested
fi

$nested &
shell=\$!
trap 'kill \$shell 2>/dev/null || true' EXIT
gdbus wait --session --timeout 60 org.gnome.Shell
bash '$payload'
EOF

echo "nested session: $nested, shortcut $shortcut"
dbus-run-session -- bash "$tmp/session.sh"
