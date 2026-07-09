uuid := "murmur@roman-16.github.io"
src := justfile_directory()
ext_dir := env_var_or_default("XDG_DATA_HOME", env_var("HOME") / ".local/share") / "gnome-shell/extensions" / uuid

# Render the extensions.gnome.org page icon (assets/icon.svg -> assets/icon.png)
icon:
    rsvg-convert --width 256 --height 256 '{{src}}/assets/icon.svg' --output '{{src}}/assets/icon.png'

# Lint (quality gate)
lint:
    oxlint

# Symlink this checkout into the extensions dir and compile the schema
install:
    glib-compile-schemas '{{src}}/schemas'
    mkdir -p "$(dirname '{{ext_dir}}')"
    ln -sfnT '{{src}}' '{{ext_dir}}'

# Run in a throwaway, isolated nested GNOME Shell (does not touch your session)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    glib-compile-schemas '{{src}}/schemas'
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    export XDG_DATA_HOME="$tmp/data" XDG_CONFIG_HOME="$tmp/config"
    ext="$XDG_DATA_HOME/gnome-shell/extensions/{{uuid}}"
    mkdir -p "$(dirname "$ext")"
    ln -sfnT '{{src}}' "$ext"
    export GSETTINGS_SCHEMA_DIR="$ext/schemas"
    cat >"$tmp/init.sh" <<'EOF'
    gsettings set org.gnome.shell enabled-extensions "['{{uuid}}']"
    if [ -n "${MISTRAL_API_KEY:-}" ]; then
        gsettings set org.gnome.shell.extensions.murmur mistral-api-key "$MISTRAL_API_KEY"
    fi
    if [ -n "${RECORDING_SHORTCUT:-}" ]; then
        gsettings set org.gnome.shell.extensions.murmur toggle-recording "['$RECORDING_SHORTCUT']"
    fi
    exec gnome-shell --devkit
    EOF
    dbus-run-session -- bash "$tmp/init.sh"

# Build the distributable zip (CI does this on release)
pack:
    gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.murmur.gschema.xml --extra-source=lib --extra-source=LICENSE .
