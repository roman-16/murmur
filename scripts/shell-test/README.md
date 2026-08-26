# Driving the shell

```bash
just test-shell
```

Boots a throwaway, headless GNOME Shell with two screens, builds the recording panel inside it, clicks it with a real pointer, and reports what worked. It takes about half a minute, touches nothing in your session, and needs no key, no network and no microphone.

`just test` covers the changelog parser, which is pure and fast. This covers the half of Murmur that only exists inside a compositor, where the interesting failures are: an actor that is drawn but cannot be clicked, a keyboard that is taken and never given back, chrome that outlives the recording.

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
| `probe@murmur.local/window.js` | A real GTK client, because an extension cannot produce a window |

The probe reaches Murmur's modules through `Main.extensionManager.lookup()`, so it tests the built `dist/` that GNOME Shell actually loads rather than the TypeScript.

## What it checks

- An accelerator becomes the label the panel prints.
- All four controls are hit-testable, and **clicking each one does something**.
- Taking and releasing the keyboard shows on the panel, and clicking the panel takes it back.
- The panel collapses both ways it should: when an application comes forward, and when it loses the keyboard it was holding.
- The panel opens on the monitor holding the focused window, and above a dock that reserves space there. The session has a second screen for exactly this: on one monitor with nothing docked to it, placing the panel where the work is and always placing it on the primary are the same rule.
- Destroying the panel leaves no chrome and no top-bar indicator, and destroying it twice is safe.
- The extension survives being disabled and enabled.

## What it does not check

Anything that needs the microphone, the network or a Mistral key, which is the recording session itself. `scripts/changelog.test.ts` covers the changelog parser. Insertion is the one important gap: synthesizing keystrokes into a client and reading them back is a bigger harness than this, and [`CONTRIBUTING.md`](../../CONTRIBUTING.md) lists the manual passes that stand in for it.

It does not run in CI, because a GitHub runner has no GNOME Shell and standing one up there is a flakier thing than the bugs it would catch. Run it before a pull request that touches `src/lib/shell/`.
