# How it works

Murmur is a GNOME Shell extension, which means it runs inside the compositor itself. There is no daemon, no tray process and no companion service: the shortcut, the panel, the microphone, the network connection and the insertion are all the same process.

## One dictation, start to finish

1. **The shortcut fires.** `Super+Space` is a shell keybinding, active in the normal session and in the overview.
2. **The panel opens** at the bottom of the monitor holding the focused window - the pointer's monitor when nothing is focused - clear of anything docked there, showing the status, a countdown, the destination, and the transcription as it arrives, alongside an indicator in the top bar. Nothing is grabbed: the panel is drawn as shell chrome and, unless it holds the keyboard, every click and keystroke goes where it would have anyway.
3. **The microphone opens.** `pw-record` is spawned and writes raw audio to a pipe: 16 kHz, mono, signed 16-bit little-endian, read in 100 ms chunks.
4. **A WebSocket opens** to `wss://api.mistral.ai/v1/audio/transcriptions/realtime`, authenticated with your API key, and the session announces the audio format and the transcription delay.
5. **Audio streams up** as it is recorded, each chunk base64-encoded in a JSON message. Nothing is buffered to disk.
6. **Text streams down** as `transcription.text.delta` events and appears in the panel immediately.
7. **You stop**, or silence or the time limit stops it for you. The microphone is released at once, and the connection stays open just long enough to collect the tail of the transcription.
8. **The destination is read**, now rather than at the start: whichever client holds a focused text field at this moment. See [Where the text goes](text-insertion.md).
9. **The panel releases the keyboard and closes**, and the text is delivered: typed into the focused field, or copied to the clipboard when there is none, which the panel says before it goes.

`Esc` cancels at any point. The subprocess is signalled, the socket is closed, and nothing is inserted or copied.

## Why keys reach the panel, and when they do not

On Wayland the compositor sends key events to the focused window's surface. It makes one exception, which GNOME uses for keyboard navigation in its own top bar: when an actor inside the shell holds the stage's key focus, key events are not forwarded to the client and reach that actor instead.

Murmur's panel uses exactly that, so no grab is involved and three things follow for free:

- **Compositor keybindings still fire**, because they are processed before that check. `Super+Space` works whatever holds the keyboard.
- **Focusing any window clears the stage's key focus**, which mutter does itself, as does anything in the shell that takes the keyboard, the overview included. Murmur watches that one signal and collapses the panel whenever it is no longer the focus, which is how the panel comes to be on screen exactly while it holds your keyboard.
- **The client keeps its text-input focus throughout**, because the stage's key focus does not change which window the compositor considers focused. That is what lets the destination be read at the end instead of frozen at the start.

Synthesized keystrokes are routed by the same rule, so the panel releases the keyboard before the transcription is typed; otherwise the text would be typed into the panel.

## Silence detection

When **Stop after silence** is on, every chunk of audio is measured before it is sent: the root mean square of its samples, as a fraction of full scale. Anything under 1% counts as silence, and silence is accumulated in *audio* time rather than wall-clock time, so a slow network or a backlog of buffered chunks can never look like a pause.

## Two processes, two halves of the code

A GNOME extension runs in two places, and they share nothing but files on disk:

| Process | Loads | In this repository |
| --- | --- | --- |
| GNOME Shell | Clutter, Meta, Shell, St | `src/extension.ts`, `src/lib/shell/` |
| The preferences window | Adw, Gdk, Gtk | `src/prefs.ts`, `src/lib/prefs/` |
| Both | Gio, GLib only | `src/lib/` |

Importing a shell type into the preferences, or a GTK type into the shell, crashes at load. `just lint` greps for exactly that and fails the build, so the boundary is enforced rather than remembered.

## The realtime protocol

Murmur speaks Mistral's realtime transcription protocol over a single WebSocket, with `voxtral-mini-transcribe-realtime-2602`.

| Direction | Message | Meaning |
| --- | --- | --- |
| Up | `session.update` | Audio format and `target_streaming_delay_ms` |
| Up | `input_audio.append` | One base64 chunk of PCM |
| Up | `input_audio.flush`, `input_audio.end` | The microphone is done |
| Down | `transcription.text.delta` | More text, appended live |
| Down | `transcription.done` | The final transcription |
| Down | `error` | Reported to you as a notification |

## Built from TypeScript

`src/` is TypeScript, type-checked against the [GNOME Shell type definitions](https://github.com/gjsify/ts-for-gir), and compiled to plain GJS modules in `dist/`, which is what the shell loads. There is no bundler and no runtime dependency: the output is the same ES modules the shell would have loaded had they been written by hand.
