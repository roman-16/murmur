# How it works

Murmur is a GNOME Shell extension, which means it runs inside the compositor itself. There is no daemon, no tray process and no companion service: the shortcut, the overlay, the microphone, the network connection and the insertion are all the same process.

## One dictation, start to finish

1. **The shortcut fires.** `Super+Space` is a shell keybinding, active in the normal session and in the overview.
2. **The destination is decided.** Murmur reads whether the focused client has a text field, before anything grabs the keyboard. See [Where the text goes](text-insertion.md).
3. **The overlay opens.** A modal dialog, centered, showing the status, a countdown, the destination, and the transcription as it arrives.
4. **The microphone opens.** `pw-record` is spawned and writes raw audio to a pipe: 16 kHz, mono, signed 16-bit little-endian, read in 100 ms chunks.
5. **A WebSocket opens** to `wss://api.mistral.ai/v1/audio/transcriptions/realtime`, authenticated with your API key, and the session announces the audio format and the transcription delay.
6. **Audio streams up** as it is recorded, each chunk base64-encoded in a JSON message. Nothing is buffered to disk.
7. **Text streams down** as `transcription.text.delta` events and appears in the overlay immediately.
8. **You stop**, or silence or the time limit stops it for you. The microphone is released at once, and the connection stays open just long enough to collect the tail of the transcription.
9. **The overlay closes** and the text is delivered: typed into the focused field, or copied to the clipboard when there is none.

`Esc` cancels at any point. The subprocess is signalled, the socket is closed, and nothing is inserted or copied.

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
