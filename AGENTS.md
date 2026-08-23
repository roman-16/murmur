# Murmur

Push-to-talk dictation for GNOME on Wayland: TypeScript in `src/`, compiled to plain GJS modules in `dist/`. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup, the code layout and the everyday commands.

## Gates

| After a change to | Run | What it covers |
| --- | --- | --- |
| anything under `src/` | `just lint` | `oxlint`, `tsc --noEmit` against the GNOME Shell type definitions, the process boundary between the shell and the preferences, and the changelog |
| `CHANGELOG.md`, or anything under `scripts/` | `just test` | The parser that decides what gets published, over its rules and the repository's own changelog |
| the packaging, or the files the extension ships | `nix build` | The extension builds from the flake and installs the layout GNOME Shell loads |

Fix every finding before the work counts as done.

## The demo is the user's to run

**Never run `just demo`.** It films a nested GNOME Shell, and a window that is covered while it films paints only rarely, which the take records as frozen frames, so a run started from this session comes out truncated. Say that `assets/demo.webp` needs re-recording and ask the user to run `just demo` with the nested window left visible. Then check what came back: around 60 frames or more, the overlay's countdown starting at the current **Maximum recording time**, and a last frame with the sentence typed into the editor.

## The changelog is the release button

[`CHANGELOG.md`](CHANGELOG.md) is not documentation about releases, it is what causes them. A version section reaching `main` is a release request: Check passes, the Release workflow reads the newest section, and that version's tag, release notes and the `version-name` the extension reports all follow from it. Nearly every push adds no section and releases nothing.

- **There is no `[Unreleased]` section here, and adding one is not how to record a change.** The parser rejects it. The file gains a section only when a release is cut, written then from the commits since the last tag.
- **Never add a version section unless the user asked for a release.** There is nowhere to park an entry: a section is a release.
- Write the commit message so the entry can be written from it later: what moved on the surface someone dictating into a text field touches, and what that means for them.
- An entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): the six categories in the specification's order, one line per change, written for the person using Murmur. Internal work gets no entry.
- Versions are `X.Y.Z` and move one step at a time. `just notes` prints what the release page would say.
