# Demo recording

`assets/demo.webp` is recorded by one command, unattended:

```bash
just demo
```

It boots a throwaway GNOME Shell, opens a text editor in it, records a dictation from start to finish and renders the animation the README shows. Nothing to press, nothing to say. It takes about a minute and needs no API key, no network and no microphone.

Leave the nested window visible while it runs. It does not need focus, and you can keep working elsewhere, but a compositor whose window is covered paints only rarely, and the animation is exactly as smooth as the painting was: a covered window turns a take into a slideshow, and a fully hidden one freezes it.

The animation carries a duration per frame, so a take always plays back over the seconds it really took, however many frames it took to get there.

## What runs

| Piece | Role |
| --- | --- |
| `record.sh` | Starts the mock, runs the session, renders the GIF and the MP4 with `ffmpeg` |
| `voxtral-mock.ts` | A scripted transcription endpoint, served by Bun, that streams the sentence word by word |
| `../nested-shell.sh` | The throwaway session, shared with `just dev` |
| `session.sh` | Inside the session: opens the editor, then records until the take is done |
| `screencast.js` | Drives GNOME's screencast service over one D-Bus connection |
| `driver@murmur.local` | An extension that performs the take from inside the compositor |

## Settings

| Variable | Default | What it changes |
| --- | --- | --- |
| `DEMO_APP_ID` | first installed candidate | The application to dictate into |
| `DEMO_CROP_TOP` | `32` | Pixels cut from the top, the height of the panel |
| `DEMO_DELTA_MS` | `320` | Pause between streamed words |
| `DEMO_FPS` | `20` | Frame rate of the animation |
| `DEMO_FRAMERATE` | `30` | Frame rate the capture is asked for |
| `DEMO_PIPELINE` | a near-transparent VP8 | The GStreamer pipeline the capture encodes with |
| `DEMO_SENTENCE` | see `voxtral-mock.ts` | What gets "said" |
| `DEMO_SHORTCUT` | `<Super>space` | The shortcut inside the session |
| `DEMO_WEBP_QUALITY` | `85` | Quality of the animation |
| `DEMO_WEBP_WIDTH` | `960` | Width of the animation |

The application is the first of `org.gnome.TextEditor`, `org.gnome.gedit`, `org.gnome.Console`, `org.gnome.Ptyxis` or `org.gnome.Terminal` installed system-wide. It has to be system-wide and D-Bus activatable, since the session gets a fresh `XDG_DATA_HOME` and can only reach it by activation.

## What is real and what is scripted

Everything on screen is the extension doing its actual work: the panel, the top-bar recording indicator, the live text arriving word by word, the countdown, the destination the panel reports, and the insertion into the editor as keystrokes. What is scripted is the **speech**: instead of a microphone and Mistral, `MURMUR_REALTIME_URL` points Murmur at a local endpoint that speaks the same protocol and streams a fixed sentence. That makes the take identical on every machine, free, and reproducible in a checkout with no key.

## The awkward parts, and why they are there

- **The driver waits for the recorder.** It performs nothing until the screencast has actually started, so the take always opens on the same frame no matter how long the service took to agree to record.
- **The take starts through the extension's own entry point**, not by pressing the shortcut. A virtual keyboard inside the compositor cannot reach a compositor keybinding while a client window holds the focus, so a synthetic `Super+Space` would go into the editor as a space. Everything after that, including the `Enter` that ends the recording, is a real keypress the panel handles, which works because the panel takes the keyboard when it opens and nothing steals the focus during the take.
- **The shortcut is still borrowed** from your session for the run, so the take is made in a session bound to `Super+Space` rather than the `Super+J` that `just dev` uses, and the recording it films is the one the README describes.
- **Animations are turned off** in the session, because transitions never advance in the development kit. The shell applies an eased value immediately when animations are off, so the panel is drawn at full opacity rather than stuck at the one its fade-in starts from.
- **Nothing is clicked during the take.** The panel collapses to the top bar as soon as anything else is clicked, which is the right thing in a session and the wrong thing in a ten-second animation, so the take never touches the pointer.
- **The welcome dialog is suppressed.** A fresh profile counts as a first login, and that dialog would take the modal and with it every shortcut.
- **The overview is pushed back down** whenever it appears. The session opens in it, and a window is only a thumbnail there.
- **No personal data is on screen.** The session has its own data directory, so it opens on a stock GNOME with no files, no history and no notifications.
- **The session is told to forget ibus.** `scripts/nested-shell.sh` unsets `GTK_IM_MODULE`, which the desktop session sets to `ibus` and this one has none of. Without that the editor never announces its text field, the panel reads *No text field focused*, and the take ends on the clipboard with an empty editor.
- **Fixed size.** The screen is 1280x800 whatever monitor it is displayed on. Passing `--virtual-monitor` would *add* a second screen and capture both side by side, so it does not.
- **The capture encodes at a quantizer GNOME would never use live.** Its own pipelines are built to keep up with a whole desktop; this one has ten seconds of a mostly still screen, so `DEMO_PIPELINE` asks for near-transparent VP8 and falls back to the default if the service refuses it. The recording is then re-encoded once, at CRF 16 and a constant frame rate, since the capture only produces a frame when the screen changes and players handle that unevenly.
- **The animation is WebP, and it is the only one.** GitHub strips a `<video>` element out of a README entirely, so an MP4 there would show nothing; an `<img>` survives, and an animated WebP plays by itself, loops and shows no controls exactly as a GIF does, at roughly a tenth of the bytes and without a 256 colour palette to dither into. Since nothing in the project displays a video file, none is kept.
- **The panel is cropped away.** `DEMO_CROP_TOP` cuts the top 32 pixels, the height of GNOME's top bar, out of every artefact: a clock and a set of status icons date the recording and say nothing about Murmur.

Re-record whenever the panel changes shape: the header, the destination line, the buttons and the hint line are all in frame, as is the top-bar indicator.
