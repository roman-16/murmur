uuid := "murmur@roman-16.github.io"
root := justfile_directory()
dist := root / "dist"
ext_dir := env_var_or_default("XDG_DATA_HOME", env_var("HOME") / ".local/share") / "gnome-shell/extensions" / uuid

oxlint := "bun " + root / "node_modules/oxlint/bin/oxlint"
tsc := "bun " + root / "node_modules/typescript/bin/tsc"

# Install the npm toolchain (type definitions, TypeScript, oxlint) when stale
[private]
deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d '{{root}}/node_modules' ] || [ '{{root}}/package.json' -nt '{{root}}/node_modules' ] || [ '{{root}}/bun.lock' -nt '{{root}}/node_modules' ]; then
        bun install
    fi

# Compile src/ into dist/, the directory GNOME Shell loads
build: deps
    rm --recursive --force '{{dist}}'
    {{tsc}}
    bun '{{root}}/scripts/metadata.ts' > '{{dist}}/metadata.json'
    cp '{{root}}/LICENSE' '{{root}}/src/stylesheet.css' '{{dist}}'
    cp --recursive '{{root}}/schemas' '{{dist}}'

# Type-check without emitting
check: deps
    {{tsc}} --noEmit

# Lint, type-check, check the process boundary and the changelog (quality gate)
lint: deps boundaries
    {{oxlint}}
    {{tsc}} --noEmit
    bun '{{root}}/scripts/changelog.ts' > /dev/null

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
        '{{root}}/src/prefs.ts' '{{root}}/src/lib/prefs'
    reject 'shell code must not reach Gtk-only APIs' \
        "gi://(Adw|Gdk|Gtk)|from '[^']*prefs/" \
        '{{root}}/src/extension.ts' '{{root}}/src/lib/shell'
    reject 'shared modules must stay loadable in both processes' \
        "gi://(Adw|Clutter|Gdk|Gtk|Meta|Shell|St)|from '[^']*(prefs|shell)/" \
        {{root}}/src/lib/*.ts
    exit $status

# Check the changelog parser, which decides what gets published
test:
    bun test '{{root}}/scripts'

# Drive the panel with a real pointer in a throwaway nested GNOME Shell
test-shell: build
    glib-compile-schemas '{{dist}}/schemas'
    bash '{{root}}/scripts/shell-test/run.sh'

# Print the version and the release notes CHANGELOG.md would publish
notes:
    bun '{{root}}/scripts/changelog.ts'
    bun '{{root}}/scripts/changelog.ts' --notes

# Record the README demo in a throwaway nested GNOME Shell (see scripts/demo)
demo: build
    glib-compile-schemas '{{dist}}/schemas'
    bash '{{root}}/scripts/demo/record.sh'

# Render the icon to upload to extensions.gnome.org, which takes no SVG
icon:
    rsvg-convert --width 256 --height 256 '{{root}}/assets/icon.svg' --output '{{root}}/assets/icon.png'

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
    glib-compile-schemas '{{dist}}/schemas'
    bash '{{root}}/scripts/nested-shell.sh'

# Build the distributable zip (CI does this on release)
pack: build
    gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.murmur.gschema.xml --extra-source=lib --extra-source=LICENSE '{{dist}}'

# Remove build output and installed dependencies
clean:
    rm --recursive --force '{{dist}}' '{{root}}/node_modules'
