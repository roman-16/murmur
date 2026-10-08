# Contributing

Thanks for helping out. Issues, ideas and pull requests are all welcome.

## Scope

Murmur is push-to-talk dictation and recording for GNOME on Wayland: one shortcut, one panel, text into the focused field; another shortcut, one pill, everything you hear and say into a file and its transcript. Things that fit are better transcription, better insertion, fewer surprises. Things that do not: other desktops, other session types, a local model bundled into the extension, and anything that needs a background service, since running entirely inside the shell is the point.

That last one is also why the dictation panel is shell chrome rather than a window: a window would need a second process, and everything a window would give it (alt-tab, minimise, stacking) is worth less than the panel appearing the instant you press the shortcut.

## Getting set up

The toolchain is pinned with [devbox](https://www.jetify.com/devbox) and [direnv](https://direnv.net/):

```bash
git clone https://github.com/roman-16/murmur.git
cd murmur
direnv allow      # or: devbox shell
cp .env.example .env      # a key for one service, and optionally MURMUR_PROVIDER, OPENROUTER_MODEL, DICTATION_SHORTCUT and RECORDING_SHORTCUT
```

Without devbox you need Bun, GJS, GLib's tools, `just`, `librsvg` and `zip` on your own, and GStreamer with its base and good plugins and PipeWire's GStreamer plugin, which the shell itself loads.

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

`just dev` boots a nested GNOME Shell with its own `XDG_DATA_HOME`, picks up the API keys in `.env`, and touches nothing in your real session. It also unsets `GTK_IM_MODULE`, because the desktop session points clients at ibus and the nested one runs none: a GTK client that cannot reach its input method never enables the Wayland text-input protocol, so every field in the nested session would look like no field and every dictation would go to the clipboard. It is the fastest way to try a change; a real session needs a log out and back in for every reload, because Wayland cannot restart the shell in place.

Inside that session the shortcuts are **`Super+J`** to dictate and **`Super+K`** to record, set by `DICTATION_SHORTCUT` and `RECORDING_SHORTCUT` in `.env`, because a key combination belongs to one compositor: your own session matches `Super+Space` first and the nested shell never sees it. When a run does need the real combination, as the demo does, `scripts/nested-shell.sh` borrows it from your session and gives it back on exit.

## How the code is arranged

```
src/extension.ts       the shell half: the shortcuts, the lock screen, and the two features it wires up
src/prefs.ts           the preferences half
src/stylesheet.css     geometry for the panel; its colours come from the shell theme
src/lib/               shared by both, Gio and GLib only: settings, history, the recording files
src/lib/shell/         shell-only: dictation, recording, audio, panel, indicators, insertion, focus, notifications
src/lib/prefs/         preferences-only: rows, shortcut capture, dotool diagnostics, history page
src/lib/transcription/ the ways audio becomes text, and the table of services
```

`audio.ts` is everything Murmur hears, through GStreamer pipelines inside the shell: a `Microphone` for a dictation, whose samples are collected from the main loop because GJS cannot run on GStreamer's threads, a `Recorder` that mixes the microphone with the default output's monitor into an Opus file as it goes, and the pieces a recording is cut into for transcription.

A dictation is `dictation.ts`, the panel and the delivery, around `session.ts`, which meters the microphone, watches for silence, and hands the audio to a `Transcription` - the seam every service's dictation comes through: fed chunks, told when the microphone is released, and finally the words. There are two implementations of it. `stream.ts` holds a WebSocket open for the dictation and drives a `StreamProtocol` - the endpoint, the frames to send, and the events to make of what comes back, which is most of `mistral.ts` and `xai.ts`. `openrouter.ts` is the other: it keeps the audio and sends it in one request when the dictation ends.

A recording is `recording.ts`, the pill and the notifications, around `recording-files.ts`, which names the files and remembers which still owe a transcript. A recording longer than ten minutes goes to the service in pieces, and its seam is a `RecordingTranscriber`, one piece's audio file in and the service's text out. Each service's is a few lines over `upload.ts`, which streams the file up as a form and sends it again when the service is busy.

Adding a service means one module holding both halves, a row in `PROVIDERS`, and its keys in the schema. Nothing else in Murmur knows which one is selected.

`just build` compiles the TypeScript into `dist/`, copies `src/stylesheet.css` and `schemas/` alongside it, and writes `metadata.json` with the `version-name` [`CHANGELOG.md`](CHANGELOG.md) declares. That is the layout GNOME Shell loads.

The two halves run in **different processes** that load different libraries. Importing `Clutter`, `Meta`, `Shell` or `St` into the preferences, or `Adw`, `Gdk` or `Gtk` into the shell, fails at load time. `just lint` greps for it and fails the build, so the boundary is checked rather than remembered.

## Conventions

- **TypeScript, strict**, type-checked against the GNOME Shell definitions. `dist/` is plain GJS modules, no bundler.
- **No comments** unless the reason genuinely cannot live in the code, usually an external constraint such as a protocol quirk or a shell API that changed shape between versions.
- **Alphabetical order** for fields, imports, keys and options where the order carries no meaning.
- **Full-length flags** in shell code and recipes: `--recursive`, not `-r`.
- **The panel is the shell's own surfaces, not a lookalike.** `popup-menu-content` for the frame, then `message`, `message-header`, `message-source-icon`, `message-source-title`, `event-time`, `message-box`, `message-content`, `message-title`, `message-action-bin`, `notification-button` and `slider` inside it, and `screen-recording-indicator` for both pills in the top bar, whose recording menu is the shell's own popup menu. Build a new element out of the class the shell already uses for that element, and check what it looks like in `data/theme/gnome-shell-sass/` in the shell's own source rather than guessing.
- **Anything that floats over a window wears a class the theme gives an edge.** Popovers and OSD panels get a border and a shadow in every theme because the shell puts them over arbitrary content; a `message` gets neither, because in the shell it only ever sits inside one of those. A card that borrows the wrong one is invisible the moment somebody's theme paints windows the colour it paints cards - which Adwaita hides and a generated theme does not.
- **The keyboard goes on the control that acts, never on the frame.** A focused surface wears the theme's focus ring for as long as it is open, and no shell surface does that. Keys the panel answers for itself are taken in the capture phase, since `St.Button` activates on `Return` whatever modifier is held.
- **Declare as little as possible in `src/stylesheet.css`.** An extension's declaration outranks the theme's, `!important` included (`ORIGIN_OFFSET_EXTENSION` in `st-theme.c`), so every property set there is one no theme can ever change. Geometry the theme has no opinion about, and nothing else: never a colour, a corner, a border, a shadow or a font. Anything that needs a colour needs a shell class instead.
- **The `@girs` types lag the shell.** They describe an API that may no longer exist, so a shell API change type-checks and then throws at runtime: `addChrome`'s `affectsInputRegion` is declared for GNOME 50 and was removed from it. It cuts the other way too - `Clutter.ClickGesture` type-checks and exists only in GNOME 50, while `metadata.json` claims 47. Check anything shell-side against the shell's own JavaScript, for the oldest version claimed as well as the newest, and run it.

## Testing a change

`just test` covers the changelog parser, because that one decides what gets published.

`just test-shell` covers the panel, by building it inside a throwaway headless GNOME Shell and clicking it with a real pointer. Run it after anything under `src/lib/shell/`; [`scripts/shell-test/README.md`](scripts/shell-test/README.md) explains why it needs a whole compositor, and why a synthetic click that never lands makes for a test that cannot fail. It is not in CI, because a runner has no GNOME Shell.

Everything past that is the compositor, and the interesting failures are all in the interaction. Before opening a pull request that touches dictation, recording or insertion, try it in `just dev` and then in a real session against, at minimum:

- a GTK application, for an ordinary field,
- a terminal, for a client that reports one big text field,
- a web-based terminal such as the one in VS Code, which only reads key events,
- the desktop with nothing focused, for the clipboard path,
- `Esc` mid-dictation, and both `Enter` and `Ctrl+Enter`,
- a password field, which must land in the field and **not** in the history page,
- clicking anywhere outside the panel mid-dictation, which must collapse it and hand the keyboard back, whether or not you changed application,
- a fullscreen window, which the panel has to be visible over,
- **all three transcription services**, since each speaks its own protocol and only one of them is exercised by a dictation - and OpenRouter is the one that transcribes nothing until the microphone closes. `MURMUR_PROVIDER=openrouter just dev` switches the throwaway session over,
- a **recording** with each service, with something playing and something said, stopped both from the shortcut and from the pill's menu, then **Open** and **Copy** on its notification, and **Discard…**,
- a recording's failure, with the network off when it stops: **Retry** once it is back, and the offer on the next start for one whose notification was dismissed,
- **locking the screen** mid-recording and mid-dictation: the recording carries on with its pill and its menu shut, the dictation ends, and neither shortcut answers until you unlock.

`journalctl --user --follow /usr/bin/gnome-shell | grep --ignore-case murmur` shows what the extension reports.

## The demo

The animation in the README records itself, unattended, in about a minute:

```bash
just demo
```

It runs a dictation in the isolated nested shell against a scripted transcription endpoint, so it needs no key, no network and no microphone, and produces the same take on every machine. Leave the nested window visible while it runs. [`scripts/demo/README.md`](scripts/demo/README.md) explains the pieces and what is real versus scripted.

## Releasing

[`CHANGELOG.md`](CHANGELOG.md) is the release button. Add a version section to it in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form and push it to `main`; that is the whole of it. The version, the tag, the release notes and the `version-name` the extension reports all come from that one section, so shipping is a decision made once, in a diff, rather than a version typed into a form afterwards.

A section may open with `### Highlights` above the categories - the few bullets somebody skims to learn what the release is about, each restating an entry below it rather than adding to it. A release that amounts to bug fixes has none.

The section is written when the release is cut, from the commits since the last tag, so there is no `[Unreleased]` heading accumulating between releases and a push that is not a release leaves the file untouched. `just notes` prints the version and the notes the file would publish.

The **Release** workflow runs when **Check** passes on `main`, reads the newest section, and stops there when a release for it is already published, which is what nearly every push does, in seconds. Otherwise it builds, packs, tags, and publishes the GitHub release with that section as its notes. The tag is pushed last on purpose: it is fetched by users and it names the release, so nothing that outlives a failed run happens until everything that can fail has passed.

The upload to extensions.gnome.org is a job of its own, after the release, because the site has no API tokens and no idea of a repeated version: uploading one version twice becomes two submissions in the review queue. When it is the part that failed, re-run that job alone, or upload the release's zip by hand on the site; re-running the whole workflow sees the release as published and does nothing.

Because the file decides and not the run, a release that failed partway through is finished by re-running it: an existing tag is reused and its own commit released rather than whatever `main` has become. `just lint` holds the file to its format, which is what keeps the button safe: versions move one step at a time, so after 1.3.2 the file may say 1.3.3, 1.4.0 or 2.0.0 and nothing else, and a pre-release is refused outright, since extensions.gnome.org allows only letters, digits, spaces and dots in a version name.

Two things the workflow cannot do, because extensions.gnome.org has no API for them: uploading the listing's icon and screenshot. Both are edited by hand on the extension's page after a release that changes them.
