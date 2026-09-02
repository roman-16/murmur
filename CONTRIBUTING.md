# Contributing

Thanks for helping out. Issues, ideas and pull requests are all welcome.

## Scope

Murmur is push-to-talk dictation for GNOME on Wayland: one shortcut, one panel, text into the focused field. Things that fit are better transcription, better insertion, fewer surprises. Things that do not: other desktops, other session types, a local model bundled into the extension, and anything that needs a background service, since running entirely inside the shell is the point.

That last one is also why the recording panel is shell chrome rather than a window: a window would need a second process, and everything a window would give it (alt-tab, minimise, stacking) is worth less than the panel appearing the instant you press the shortcut.

## Getting set up

The toolchain is pinned with [devbox](https://www.jetify.com/devbox) and [direnv](https://direnv.net/):

```bash
git clone https://github.com/roman-16/murmur.git
cd murmur
direnv allow      # or: devbox shell
cp .env.example .env      # a key for one service, and optionally MURMUR_PROVIDER and RECORDING_SHORTCUT
```

Without devbox you need Bun, GJS, GLib's tools, `just`, `librsvg` and `zip` on your own.

## Everyday commands

`just --list` is the full set. The ones you will reach for:

```bash
just build        # compile src/ into dist/
just check        # type-check only
just lint         # oxlint, type-check, the process boundary and the changelog; run before every commit
just test         # check the changelog parser
just test-shell   # drive the panel with a real pointer in a throwaway nested shell
just dev          # run in a throwaway, isolated nested GNOME Shell
just install      # symlink dist/ into your extensions dir
just notes        # print the version and the notes CHANGELOG.md would publish
just prefs        # open the preferences dialog
just pack         # build the .shell-extension.zip
```

`just lint` has to pass with no findings. It is the quality gate, and CI runs the same recipe on every push and pull request, alongside `just test` and `nix build`.

```bash
nix build         # build the extension through the flake, as a Nix install does
```

`just dev` boots a nested GNOME Shell with its own `XDG_DATA_HOME`, picks up `MISTRAL_API_KEY` from `.env`, and touches nothing in your real session. It also unsets `GTK_IM_MODULE`, because the desktop session points clients at ibus and the nested one runs none: a GTK client that cannot reach its input method never enables the Wayland text-input protocol, so every field in the nested session would look like no field and every dictation would go to the clipboard. It is the fastest way to try a change; a real session needs a log out and back in for every reload, because Wayland cannot restart the shell in place.

Inside that session the shortcut is **`Super+J`**, set by `RECORDING_SHORTCUT` in `.env`, because a key combination belongs to one compositor: your own session matches `Super+Space` first and the nested shell never sees it. When a run does need the real combination, as the demo does, `scripts/nested-shell.sh` borrows it from your session and gives it back on exit.

## How the code is arranged

```
src/extension.ts       the shell half: shortcut, panel, session, delivery
src/prefs.ts           the preferences half
src/stylesheet.css     geometry for the panel; its colours come from the shell theme
src/lib/               shared by both, Gio and GLib only
src/lib/shell/         shell-only: panel, indicator, insertion, focus, clipboard, session
src/lib/prefs/         preferences-only: rows, shortcut capture, dotool diagnostics, history page
src/lib/transcription/ one module per service, and the table of them
```

A transcription service is a WebSocket that eats raw PCM and emits text, so that is all a module there is: the endpoint, the frames to send, and the events to make of what comes back. `session.ts` owns the microphone and the socket and knows nothing about either service; adding a third one means a module, a row in `PROVIDERS`, and a key in the schema.

`just build` compiles the TypeScript into `dist/`, copies `src/stylesheet.css` and `schemas/` alongside it, and writes `metadata.json` with the `version-name` [`CHANGELOG.md`](CHANGELOG.md) declares. That is the layout GNOME Shell loads.

The two halves run in **different processes** that load different libraries. Importing `Clutter`, `Meta`, `Shell` or `St` into the preferences, or `Adw`, `Gdk` or `Gtk` into the shell, fails at load time. `just lint` greps for it and fails the build, so the boundary is checked rather than remembered.

## Conventions

- **TypeScript, strict**, type-checked against the GNOME Shell definitions. `dist/` is plain GJS modules, no bundler.
- **No comments** unless the reason genuinely cannot live in the code, usually an external constraint such as a protocol quirk or a shell API that changed shape between versions.
- **Alphabetical order** for fields, imports, keys and options where the order carries no meaning.
- **Full-length flags** in shell code and recipes: `--recursive`, not `-r`.
- **The panel is the shell's own surfaces, not a lookalike.** `popup-menu-content` for the frame, then `message`, `message-header`, `message-source-icon`, `message-source-title`, `event-time`, `message-box`, `message-content`, `message-title`, `message-action-bin`, `notification-button` and `slider` inside it, and `screen-recording-indicator` for the pill in the top bar. Build a new element out of the class the shell already uses for that element, and check what it looks like in `data/theme/gnome-shell-sass/` in the shell's own source rather than guessing.
- **Anything that floats over a window wears a class the theme gives an edge.** Popovers and OSD panels get a border and a shadow in every theme because the shell puts them over arbitrary content; a `message` gets neither, because in the shell it only ever sits inside one of those. A card that borrows the wrong one is invisible the moment somebody's theme paints windows the colour it paints cards - which Adwaita hides and a generated theme does not.
- **The keyboard goes on the control that acts, never on the frame.** A focused surface wears the theme's focus ring for as long as it is open, and no shell surface does that. Keys the panel answers for itself are taken in the capture phase, since `St.Button` activates on `Return` whatever modifier is held.
- **Declare as little as possible in `src/stylesheet.css`.** An extension's declaration outranks the theme's, `!important` included (`ORIGIN_OFFSET_EXTENSION` in `st-theme.c`), so every property set there is one no theme can ever change. Geometry the theme has no opinion about, and nothing else: never a colour, a corner, a border, a shadow or a font. Anything that needs a colour needs a shell class instead.
- **The `@girs` types lag the shell.** They describe an API that may no longer exist, so a shell API change type-checks and then throws at runtime: `addChrome`'s `affectsInputRegion` is declared for GNOME 50 and was removed from it. It cuts the other way too - `Clutter.ClickGesture` type-checks and exists only in GNOME 50, while `metadata.json` claims 47. Check anything shell-side against the shell's own JavaScript, for the oldest version claimed as well as the newest, and run it.

## Testing a change

`just test` covers the changelog parser, because that one decides what gets published.

`just test-shell` covers the panel, by building it inside a throwaway headless GNOME Shell and clicking it with a real pointer. Run it after anything under `src/lib/shell/`; [`scripts/shell-test/README.md`](scripts/shell-test/README.md) explains why it needs a whole compositor, and why a synthetic click that never lands makes for a test that cannot fail. It is not in CI, because a runner has no GNOME Shell.

Everything past that is the compositor, and the interesting failures are all in the interaction. Before opening a pull request that touches recording or insertion, try it in `just dev` and then in a real session against, at minimum:

- a GTK application, for an ordinary field,
- a terminal, for a client that reports one big text field,
- a web-based terminal such as the one in VS Code, which only reads key events,
- the desktop with nothing focused, for the clipboard path,
- `Esc` mid-recording, and both `Enter` and `Ctrl+Enter`,
- a password field, which must land in the field and **not** in the history page,
- clicking anywhere outside the panel mid-recording, which must collapse it and hand the keyboard back, whether or not you changed application,
- a fullscreen window, which the panel has to be visible over,
- **both transcription services**, since each speaks its own protocol and only one of them is exercised by a dictation. `MURMUR_PROVIDER=gemini just dev` switches the throwaway session over.

`journalctl --user --follow /usr/bin/gnome-shell | grep --ignore-case murmur` shows what the extension reports.

## The demo

The animation in the README records itself, unattended, in about a minute:

```bash
just demo
```

It runs a dictation in the isolated nested shell against a scripted transcription endpoint, so it needs no key, no network and no microphone, and produces the same take on every machine. Leave the nested window visible while it runs. [`scripts/demo/README.md`](scripts/demo/README.md) explains the pieces and what is real versus scripted.

## Releasing

[`CHANGELOG.md`](CHANGELOG.md) is the release button. Add a version section to it in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form and push it to `main`; that is the whole of it. The version, the tag, the release notes and the `version-name` the extension reports all come from that one section, so shipping is a decision made once, in a diff, rather than a version typed into a form afterwards.

The section is written when the release is cut, from the commits since the last tag, so there is no `[Unreleased]` heading accumulating between releases and a push that is not a release leaves the file untouched. `just notes` prints the version and the notes the file would publish.

The **Release** workflow runs when **Check** passes on `main`, reads the newest section, and stops there when a release for it is already published, which is what nearly every push does, in seconds. Otherwise it builds, packs, tags, and publishes the GitHub release with that section as its notes. The tag is pushed last on purpose: it is fetched by users and it names the release, so nothing that outlives a failed run happens until everything that can fail has passed.

The upload to extensions.gnome.org is a job of its own, after the release, because the site has no API tokens and no idea of a repeated version: uploading one version twice becomes two submissions in the review queue. When it is the part that failed, re-run that job alone, or upload the release's zip by hand on the site; re-running the whole workflow sees the release as published and does nothing.

Because the file decides and not the run, a release that failed partway through is finished by re-running it: an existing tag is reused and its own commit released rather than whatever `main` has become. `just lint` holds the file to its format, which is what keeps the button safe: versions move one step at a time, so after 1.3.2 the file may say 1.3.3, 1.4.0 or 2.0.0 and nothing else, and a pre-release is refused outright, since extensions.gnome.org allows only letters, digits, spaces and dots in a version name.

Two things the workflow cannot do, because extensions.gnome.org has no API for them: uploading the listing's icon and screenshot. Both are edited by hand on the extension's page after a release that changes them.
