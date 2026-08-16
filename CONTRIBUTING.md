# Contributing

Thanks for helping out. Issues, ideas and pull requests are all welcome.

## Scope

Murmur is push-to-talk dictation for GNOME on Wayland: one shortcut, one overlay, text into the focused field. Things that fit are better transcription, better insertion, fewer surprises. Things that do not: other desktops, other session types, a local model bundled into the extension, and anything that needs a background service, since running entirely inside the shell is the point.

## Getting set up

The toolchain is pinned with [devbox](https://www.jetify.com/devbox) and [direnv](https://direnv.net/):

```bash
git clone https://github.com/roman-16/murmur.git
cd murmur
direnv allow      # or: devbox shell
cp .env.example .env      # MISTRAL_API_KEY, and optionally RECORDING_SHORTCUT
```

Without devbox you need Bun, GJS, GLib's tools, `just`, `librsvg` and `zip` on your own.

## Everyday commands

`just --list` is the full set. The ones you will reach for:

```bash
just build        # compile src/ into dist/
just check        # type-check only
just lint         # oxlint, type-check and the process boundary; run before every commit
just dev          # run in a throwaway, isolated nested GNOME Shell
just install      # symlink dist/ into your extensions dir
just prefs        # open the preferences dialog
just pack         # build the .shell-extension.zip
```

`just lint` has to pass with no findings. It is the quality gate, and CI runs the same recipe.

`just dev` boots a nested GNOME Shell with its own `XDG_DATA_HOME`, picks up `MISTRAL_API_KEY` from `.env`, and touches nothing in your real session. It is the fastest way to try a change; a real session needs a log out and back in for every reload, because Wayland cannot restart the shell in place.

Inside that session the shortcut is **`Super+M`**, set by `RECORDING_SHORTCUT` in `.env`, because a key combination belongs to one compositor: your own session matches `Super+Space` first and the nested shell never sees it. When a run does need the real combination, as the demo does, `scripts/nested-shell.sh` borrows it from your session and gives it back on exit.

## How the code is arranged

```
src/extension.ts     the shell half: shortcut, overlay, session, delivery
src/prefs.ts         the preferences half
src/stylesheet.css   styling for the overlay and the toast
src/lib/             shared by both, Gio and GLib only
src/lib/shell/       shell-only: overlay, insertion, focus, clipboard, toast, session
src/lib/prefs/       preferences-only: rows, shortcut capture, dotool diagnostics
```

`just build` compiles the TypeScript into `dist/` and copies `src/stylesheet.css`, `metadata.json` and `schemas/` alongside it, which is the layout GNOME Shell loads.

The two halves run in **different processes** that load different libraries. Importing `Clutter`, `Meta`, `Shell` or `St` into the preferences, or `Adw`, `Gdk` or `Gtk` into the shell, fails at load time. `just lint` greps for it and fails the build, so the boundary is checked rather than remembered.

## Conventions

- **TypeScript, strict**, type-checked against the GNOME Shell definitions. `dist/` is plain GJS modules, no bundler.
- **No comments** unless the reason genuinely cannot live in the code, usually an external constraint such as a protocol quirk or a shell API that changed shape between versions.
- **Alphabetical order** for fields, imports, keys and options where the order carries no meaning.
- **Full-length flags** in shell code and recipes: `--recursive`, not `-r`.

## Testing a change

There is no automated suite; the surface is the compositor, and the interesting failures are all in the interaction. Before opening a pull request that touches recording or insertion, try it in `just dev` and then in a real session against, at minimum:

- a GTK application, for the input-method path,
- a terminal, for a client that reports one big text field,
- an XWayland application, for the typing path,
- the desktop with nothing focused, for the clipboard path,
- `Esc` mid-recording, and both `Enter` and `Ctrl+Enter`.

`journalctl --user --follow /usr/bin/gnome-shell | grep --ignore-case murmur` shows what the extension reports.

## The demo

The animation in the README records itself, unattended, in about a minute:

```bash
just demo
```

It runs a dictation in the isolated nested shell against a scripted transcription endpoint, so it needs no key, no network and no microphone, and produces the same take on every machine. Leave the nested window visible while it runs. [`scripts/demo/README.md`](scripts/demo/README.md) explains the pieces and what is real versus scripted.

## Releasing

Releases are cut by the **Release** workflow, dispatched by hand with a semantic version. It bumps `version-name` in `metadata.json`, commits, tags, builds, packs the zip, uploads it to extensions.gnome.org, and creates the GitHub release.

Two things it cannot do, because extensions.gnome.org has no API for them: uploading the listing's icon and screenshot. Both are edited by hand on the extension's page after a release that changes them.
