uuid := "murmur@roman-16.github.io"
src := justfile_directory()
dist := src / "dist"
ext_dir := env_var_or_default("XDG_DATA_HOME", env_var("HOME") / ".local/share") / "gnome-shell/extensions" / uuid

oxlint := "bun " + src / "node_modules/oxlint/bin/oxlint"
tsc := "bun " + src / "node_modules/typescript/bin/tsc"

# Install the npm toolchain (type definitions, TypeScript, oxlint) when stale
[private]
deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d '{{src}}/node_modules' ] || [ '{{src}}/package.json' -nt '{{src}}/node_modules' ] || [ '{{src}}/bun.lock' -nt '{{src}}/node_modules' ]; then
        bun install
    fi

# Compile src/ into dist/, the directory GNOME Shell loads
build: deps
    rm --recursive --force '{{dist}}'
    {{tsc}}
    cp '{{src}}/LICENSE' '{{src}}/metadata.json' '{{src}}/stylesheet.css' '{{dist}}'
    cp --recursive '{{src}}/schemas' '{{dist}}'

# Type-check without emitting
check: deps
    {{tsc}} --noEmit

# Lint, type-check and check the process boundary (quality gate)
lint: deps boundaries
    {{oxlint}}
    {{tsc}} --noEmit

# The shell process and the preferences process load disjoint libraries, so
# lib/shell, lib/prefs and the modules shared by both must stay apart.
[private]
boundaries:
    #!/usr/bin/env bash
    set -uo pipefail
    status=0
    reject() {
        local message=$1 pattern=$2
        shift 2
        if grep --recursive --line-number --extended-regexp "$pattern" "$@"; then
            echo "error: $message" >&2
            status=1
        fi
    }
    reject 'preferences code must not reach shell-only APIs' \
        "gi://(Clutter|Meta|Shell|St)|from '[^']*shell/" \
        '{{src}}/src/prefs.ts' '{{src}}/src/lib/prefs'
    reject 'shell code must not reach Gtk-only APIs' \
        "gi://(Adw|Gdk|Gtk)|from '[^']*prefs/" \
        '{{src}}/src/extension.ts' '{{src}}/src/lib/shell'
    reject 'shared modules must stay loadable in both processes' \
        "gi://(Adw|Clutter|Gdk|Gtk|Meta|Shell|St)|from '[^']*(prefs|shell)/" \
        {{src}}/src/lib/*.ts
    exit $status

# Render the extensions.gnome.org page icon (assets/icon.svg -> assets/icon.png)
icon:
    rsvg-convert --width 256 --height 256 '{{src}}/assets/icon.svg' --output '{{src}}/assets/icon.png'

# Symlink the build output into the extensions dir and compile the schema
install: build
    glib-compile-schemas '{{dist}}/schemas'
    mkdir --parents "$(dirname '{{ext_dir}}')"
    ln --symbolic --force --no-dereference --no-target-directory '{{dist}}' '{{ext_dir}}'

# Open the preferences dialog (after the shell knows the extension)
prefs:
    gnome-extensions prefs '{{uuid}}'

# Run in a throwaway, isolated nested GNOME Shell (does not touch your session)
dev: build
    #!/usr/bin/env bash
    set -euo pipefail
    glib-compile-schemas '{{dist}}/schemas'
    tmp=$(mktemp --directory); trap 'rm --recursive --force "$tmp"' EXIT
    export XDG_DATA_HOME="$tmp/data" XDG_CONFIG_HOME="$tmp/config"
    ext="$XDG_DATA_HOME/gnome-shell/extensions/{{uuid}}"
    mkdir --parents "$(dirname "$ext")"
    ln --symbolic --force --no-dereference --no-target-directory '{{dist}}' "$ext"
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
pack: build
    gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.murmur.gschema.xml --extra-source=lib --extra-source=LICENSE '{{dist}}'

# Remove build output and installed dependencies
clean:
    rm --recursive --force '{{dist}}' '{{src}}/node_modules'
