# Murmur

Push-to-talk dictation for GNOME on Wayland: TypeScript in `src/`, compiled to plain GJS modules in `dist/`. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup, the code layout and the everyday commands.

## Gates

| After a change to | Run | What it covers |
| --- | --- | --- |
| anything under `src/` | `just lint` | `oxlint`, `tsc --noEmit` against the GNOME Shell type definitions, and the process boundary between the shell and the preferences |
| the packaging, or the files the extension ships | `nix build` | The extension builds from the flake and installs the layout GNOME Shell loads |

Fix every finding before the work counts as done.
