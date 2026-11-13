# Driving the shell

```bash
just test-shell
```

Boots a throwaway, headless GNOME Shell with two screens, builds the dictation panel and the recording pill inside it, clicks them with a real pointer, holds both shortcuts down on a virtual keyboard, runs GStreamer inside it for a few seconds, and reports what worked. It takes about half a minute, touches nothing in your session, and needs no key and no network. It does need a text editor or a terminal installed, as something to focus, and `pw-cat`, which ships with PipeWire, to play and listen beside the recording; and it hears a second or two of whatever the machine hears, into the session's throwaway cache, which it deletes. With nobody logged in at the desktop PipeWire has no microphone, and the session hears a silent stand-in that goes away with it.

`just test` covers the changelog parser, which is pure and fast. This covers the half of Murmur that only exists inside a compositor, where the interesting failures are: an actor that is drawn but cannot be clicked, a keyboard that is taken and never given back, chrome that outlives the dictation.

## Why a whole compositor

The bug that caused this to exist: every button on the panel was hit-testable, wired to a working handler, and did nothing when clicked. `St.Button` recognises a click through a `Clutter.ClickGesture`, and an ancestor that answered `button-press-event` with `Clutter.EVENT_STOP` cancelled the gesture before it could recognise. Nothing short of pressing the button finds that. Type-checking cannot, and neither can constructing the widget and calling its signal by hand.

So the probe presses the button, from a position it computed off the actor's own allocation.

**A press that never lands is a test that cannot fail.** The first version of this harness fired synthetic pointer events into a headless session and passed while clicking nothing at all, because a virtual pointer device emits motion without moving the pointer, and the press went to whatever was underneath. `Clutter.Seat.warp_pointer()` first is what makes the click real. If these checks ever start passing suspiciously fast, confirm `hover` actually becomes true before trusting them.

## What runs

| Piece | Role |
| --- | --- |
| `run.sh` | Sets up the run and turns the probe's report into an exit status |
| `../nested-shell.sh` | The throwaway session, shared with `just dev` and the demo |
| `session.sh` | Inside the session: waits for the probe to finish |
| `probe@murmur.local` | An extension that performs the checks from inside the compositor |
| `probe@murmur.local/restyle.css` | What an extension that restyles the shell paints a notification with, loaded for the one check about it |
| `mistral-mock.ts` | A stand-in for Mistral on `127.0.0.1`, which `MURMUR_SERVICE_URL` sends every transcription request to. It answers a sentence for the key `probe` and nothing for `probe-silent` |
| An installed application | A real client to focus, because an extension cannot produce a window |

The client is whichever of `org.gnome.TextEditor`, `org.gnome.gedit`, `org.gnome.Console`, `org.gnome.Ptyxis` or `org.gnome.Terminal` is installed system-wide, launched by the compositor itself.

It has to be an application the session already has rather than a window this harness builds. Announcing a text field takes a whole toolkit; a toolkit loads only in an interpreter from the closure it was built against; and inside a devbox shell the `gjs` on the path and the GTK on the machine are not that pair, so a client of our own aborts before it opens anything. The session's applications are linked correctly by construction, and they are what a real dictation is aimed at anyway.

The probe reaches Murmur's modules through `Main.extensionManager.lookup()`, so it tests the built `dist/` that GNOME Shell actually loads rather than the TypeScript.

## What it checks

- An accelerator becomes the label the panel prints.
- A transcript with line breaks in it becomes one line, so nothing Murmur types is an `Enter`.
- All four controls are hit-testable, and **clicking each one does something**.
- Every control is a full-size one, 40px or taller, with its label sitting in the middle of it. Set a height in CSS and a button grows; whether what is written on it follows is St's business, and only measuring it tells you.
- A stylesheet that paints every notification with `!important`, as an extension that restyles the shell does, leaves the one inside the panel without a surface of its own, so the panel stays one surface under it.
- Three lines of transcription are in view before a word is spoken.
- Taking and releasing the keyboard shows on the panel, and clicking the panel takes it back.
- The panel collapses both ways it should: when an application comes forward, and when it loses the keyboard it was holding.
- The panel opens on the monitor holding the focused window, and above a dock that reserves space there. The session has a second screen for exactly this: on one monitor with nothing docked to it, placing the panel where the work is and always placing it on the primary are the same rule.
- Destroying the panel leaves no chrome and no top-bar indicator, and destroying it twice is safe.
- The recording pill reaches the top bar with its running time, and a click opens its menu with both levels and the limit. **Stop and transcribe** stops; **Discard…** asks first and discards once confirmed; locking the screen keeps the menu shut and unlocking gives it back; a recording being transcribed says so and has nothing left to stop; destroying it leaves nothing.
- An empty file is written and answered for, which is what a list of no recordings is.
- Each shortcut, held down for a second and a half, starts one dictation that is still listening and one recording that is still running when the keys come up, and pressing it again ends each. A key held that long repeats, and a binding that takes the repeats stops and starts again for as long as it is held. The recording, stopped with no words heard, keeps its audio, writes no transcript and is not left waiting to be transcribed.
- A recording is on disk while it still runs. Murmur disabled and enabled again under it, as the shell does to an extension when one enabled before it is switched off, carries the recording on about a second later; stopped, it is one audio file holding what was recorded before and after on the same channels, and one transcript that notes where nothing was recorded.
- GStreamer runs inside the compositor: a recording hears the microphone and the desktop and writes an Ogg Opus file that keeps them on channels of their own and names them in its tags, and a dictation's microphone delivers whole samples and then its end. A second and a half of stereo laid out the same way is planned as overlapping pieces, a channel of it is cut at the length its piece hears, a silent channel is not cut at all, a stretch a whole number of half seconds long is still heard, and the whole of it can be cut as one track. Nothing short of running the pipelines shows that the shell's bindings and every plugin are there.
- A recording transcribed over the bus ends in a notification offering **Open** and **Copy path**. Hovering its banner shows the buttons, and clicking **Copy path** with the pointer puts the transcript's path on the clipboard, beside the audio and holding what the stand-in said. One where no words were heard says so and writes no transcript, **Copy path** gives the audio's path instead, and a transcript already beside the audio stays as it was.
- What goes on around a recording is noted, made to happen for real while Murmur's own microphone is open: the computer's name, the windows open and the one in front, a process playing and one listening through PipeWire and both stopping, a media player on the session bus with its title and artist, time without input and the touch that ends it, and the screen locking and unlocking - and Murmur's own microphone never counted as a call.
- A recording with a context log is transcribed into a header and bracketed lines among what was said, and the log goes once its audio is gone and the extension starts again.
- The extension survives being disabled and enabled.

## What it does not check

What the real services say over their sockets or answer to an upload: the run talks only to the stand-in, in the shape Mistral answers. `scripts/transcript.test.ts` covers how what they answer becomes the transcript file, and `scripts/changelog.test.ts` the changelog parser. Insertion is the one important gap: synthesizing keystrokes into a client and reading them back is a bigger harness than this, and [`CONTRIBUTING.md`](../../CONTRIBUTING.md) lists the manual passes that stand in for it.

It does not run in CI, because a GitHub runner has no GNOME Shell and standing one up there is a flakier thing than the bugs it would catch. Run it before a pull request that touches `src/lib/shell/` or the shortcuts in `src/extension.ts`.
