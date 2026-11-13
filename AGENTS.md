# Murmur

Push-to-talk dictation for GNOME on Wayland: TypeScript in `src/`, compiled to plain GJS modules in `dist/`. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup, the code layout and the everyday commands.

## Gates

| After a change to | Run | What it covers |
| --- | --- | --- |
| anything under `src/` | `just lint` | `oxlint`, `tsc --noEmit` against the GNOME Shell type definitions, the process boundary between the shell and the preferences, and the changelog |
| anything under `src/`, or `metadata.json` | `just review` | Shexli, the checker extensions.gnome.org prints above every review, on the built extension. It fails on any notice but the ones `scripts/review.ts` expects |
| anything under `src/lib/shell/` | `just test-shell` | The panel, built inside a throwaway headless GNOME Shell and clicked with a real pointer. Takes about half a minute and touches nothing in the session |
| `CHANGELOG.md`, `src/lib/transcript.ts`, `src/lib/context-log.ts`, or anything under `scripts/` | `just test` | The parser that decides what gets published, over its rules and the repository's own changelog, how a recording's pieces become a transcript, and how what was around it is kept and written |
| the packaging, or the files the extension ships | `nix build` | The extension builds from the flake and installs the layout GNOME Shell loads |

Fix every finding before the work counts as done.

The shell half is only really checked by running it. `tsc` type-checks against definitions that lag the shell, so an API that no longer exists still passes; and a synthetic click that never lands makes a test that cannot fail. When adding a check to `scripts/shell-test/`, break the code on purpose first and watch it fail.

## What extensions.gnome.org reviews

Every release is uploaded to extensions.gnome.org, where a reviewer reads the built JavaScript by hand, beside Shexli's notices. These hold because a version that breaks one is rejected:

- The comment that opens `disable()` in `src/extension.ts` stays the first thing in its body and names `unlock-dialog`: the review guidelines require the reason there, and the checker looks nowhere else.
- A `gi://` import carries no `?version=`, and GStreamer is initialised only when `Gst.is_initialized()` is false.
- A timer's id belongs to the object that is destroyed with it: cleared on the line before it is set, and in that object's `destroy()`.
- Teardown runs unconditionally. No flag guards a `destroy()` or a `stop()`; a resource's own handle is the only check.
- Teardown is called `destroy()`: the checker does not see cleanup under another name.
- Nothing survives `disable()` in memory. What a recording needs across it is the `interrupted-recording` setting.

## The demo

`just demo` films a headless GNOME Shell and rewrites `assets/demo.webp`. Nothing has to stay visible and nobody has to be at the desktop, so run it when a change alters what a dictation looks like. Then check what came back: around 60 frames or more, the panel's countdown starting at the current **Maximum dictation time**, and a last frame with the sentence typed into the editor.

With nobody logged in at the desktop PipeWire has no microphone, a headless run brings a silent stand-in, and the take's level stays flat where a take made at the desktop moves. Say which kind of take came back, so the user can decide whether it replaces the one in the README.

## The changelog is the release button

[`CHANGELOG.md`](CHANGELOG.md) is not documentation about releases, it is what causes them. A version section reaching `main` is a release request: Check passes, the Release workflow reads the newest section, and that version's tag, release notes and the `version-name` the extension reports all follow from it. Nearly every push adds no section and releases nothing.

- **There is no `[Unreleased]` section here, and adding one is not how to record a change.** The parser rejects it. The file gains a section only when a release is cut, written then from the commits since the last tag.
- **Never add a version section unless the user asked for a release.** There is nowhere to park an entry: a section is a release.
- Write the commit message so the entry can be written from it later: what moved on the surface someone dictating into a text field touches, and what that means for them.
- An entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): the six categories in the specification's order, one line per change, written for the person using Murmur. Internal work gets no entry.
- A release may open with `### Highlights`, above the categories: the few bullets somebody skims to learn what it is about, each `- **Theme** - what they can now do, and where`. Nothing appears there that is not already an entry below, so it is written last, from the ledger. A release whose answer is "bug fixes" has none, and then the section is absent rather than thin.
- Versions are `X.Y.Z` and move one step at a time. `just notes` prints what the release page would say.

## After a push

A push is not done until its runs are. After every `git push`, watch the runs on the pushed commit to their end and report what each concluded.

- `gh run list --commit <sha>` lists them and `gh run watch <id> --exit-status` follows one. Both only read, so neither needs approval.
- On `main`, **Release** starts only once **Check** has completed, so it is not in the list right after the push: watch Check, then find the Release run that follows it and watch that too.
- When the push carries a version section, that Release run is the release. Confirm the tag, the GitHub release, and the `extensions-website` job, which is the upload to extensions.gnome.org.
- Report a failed run with its failing step's log, `gh run view <id> --log-failed`, and never re-run one without approval. When `extensions-website` alone failed, re-running that one job is the fix: re-running the whole workflow finds the release published and does nothing.
