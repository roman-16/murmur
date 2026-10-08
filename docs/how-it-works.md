# How it works

Murmur is a GNOME Shell extension, which means it runs inside the compositor itself. There is no daemon, no tray process and no companion service: the shortcuts, the panel, the microphone, the network connection and the insertion are all the same process. Audio is captured and encoded by GStreamer, which the shell already carries, on threads of its own, so none of it runs on the thread that draws the screen.

## One dictation, start to finish

1. **The shortcut fires.** `Super+Space` is a shell keybinding, active in the normal session and in the overview.
2. **The panel opens** at the bottom of the monitor holding the focused window - the pointer's monitor when nothing is focused - clear of anything docked there, showing the status, the level of your voice, a countdown, the destination, and the transcription as it arrives, alongside an indicator in the top bar. Nothing is grabbed: the panel is drawn as shell chrome and, unless it holds the keyboard, every click and keystroke goes where it would have anyway.
3. **The microphone opens.** A GStreamer pipeline captures the default PipeWire source and converts it to 16 kHz, mono, signed 16-bit little-endian. GJS cannot run JavaScript on GStreamer's own threads, so what it has heard is collected from the main loop every 100 ms; until the service is ready it waits in the pipeline, so nothing said meanwhile is lost.
4. **The service is opened**, authenticated with your API key in a request header. A streaming service gets a WebSocket and is told the audio format and whatever else it takes, in the address or in a first message: the model and the transcription delay. OpenRouter is opened by being sent the dictation, so nothing happens here at all.
5. **The audio goes up.** Streaming, each chunk goes as it is heard - raw in a binary frame to xAI, base64-encoded in a JSON message to Mistral; a service that has to finish its own setup first gets the chunks the moment it says it is ready, so no words are lost to the handshake. With OpenRouter the chunks are collected in memory instead. Nothing is buffered to disk either way.
6. **Text comes down** and appears in the panel immediately - from a streaming service, which is the only kind that has anything to say before you stop.
7. **You stop**, or silence or the time limit stops it for you. The microphone is released at once, once what it had already heard has been handed over. A streaming connection stays open just long enough to collect the tail of the transcription; OpenRouter is sent the whole dictation as a WAV and answers with the whole transcription.
8. **The destination is read**, now rather than at the start: whichever client holds a focused text field at this moment. See [Where the text goes](text-insertion.md).
9. **The panel releases the keyboard and closes**, and the text is delivered: typed into the focused field, or copied to the clipboard when there is none, which the panel says before it goes.
10. **The transcription is appended to the history**, `history.jsonl` in the extension's directory under `$XDG_STATE_HOME`, unless **Remember what I dictate** is off or the field was one the client reported as a password.

`Esc` cancels at any point. The microphone is closed, the socket is closed, and nothing is inserted or copied.

Locking the screen ends a dictation the same way, because on the lock screen the focused field is the password field.

## One recording, start to finish

1. **The shortcut fires.** `Super+Alt+Space`, a shell keybinding like the dictation's.
2. **Two files are named** in `~/Documents/Murmur` after the local time: `2026-03-26T22-02-34.opus` is created, readable by you alone, and its name is noted in `untranscribed` in the extension's directory under `$XDG_STATE_HOME`.
3. **A pipeline starts** with two sources: the default PipeWire source, which is your microphone, and a capture stream that asks WirePlumber for the default sink, which links it to the monitor of whatever your computer plays through and follows the default when it changes. Each is converted to 48 kHz mono and measured by a `level` element, and `audiomixer` mixes the two, keeping them aligned and carrying on with silence where one goes quiet. The pipeline keeps time by the system's monotonic clock, the one PipeWire stamps every captured buffer with, and each source asks PipeWire for as many buffers as it allows, so nothing captured is dropped while a source waits its turn. `opusenc` encodes the mix at 24 kbit/s and `oggmux` writes it to the file as it goes, so hours of audio never pass through the shell's memory.
4. **A pill appears in the top bar**, with the running time. Its menu shows the two levels, the service's limit when it has one, **Stop and transcribe**, and **Discard…**. The keyboard is never taken.
5. **You stop**, or the service's limit stops it for you. The end of the stream is sent through the pipeline so the muxer writes the last page, and the file is closed; a source that went quiet gets three seconds to pass the end on before the pipeline closes without it.
6. **The recording goes up** in one `POST` to the selected service's file endpoint, a form with the audio as its last part, assembled in a temporary file and streamed from there. The pill says *Transcribing…* meanwhile, and a new recording can start beside it.
7. **The transcript is written** to `2026-03-26T22-02-34.md`, exactly the `text` the service answered with, and the name leaves `untranscribed`. A notification offers **Open** and **Copy**.

A recording carries on while the screen is locked, which is why Murmur declares the `unlock-dialog` session mode: without it GNOME disables every extension when the screen locks. On the lock screen both shortcuts are unbound, a dictation cannot run, and the pill's menu does not open.

When the upload fails, the audio stays and the notification offers **Retry**. When the shell stops mid-recording - a logout, a crash, the extension switched off - the pipeline is closed where it stands, the file is still a playable Ogg file up to that point, and its name is still in `untranscribed`, so the next time Murmur starts it offers **Transcribe** or **Leave it**. A transcript you delete later is never asked for again.

## Why keys reach the panel, and when they do not

On Wayland the compositor sends key events to the focused window's surface. It makes one exception, which GNOME uses for keyboard navigation in its own top bar: when an actor inside the shell holds the stage's key focus, key events are not forwarded to the client and reach that actor instead.

Murmur's panel uses exactly that, so no grab is involved and three things follow for free:

- **Compositor keybindings still fire**, because they are processed before that check. `Super+Space` works whatever holds the keyboard.
- **Focusing any window clears the stage's key focus**, which mutter does itself, as does anything in the shell that takes the keyboard, the overview included. Murmur watches that one signal and collapses the panel whenever it is no longer the focus, which is how the panel comes to be on screen exactly while it holds your keyboard.
- **The client keeps its text-input focus throughout**, because the stage's key focus does not change which window the compositor considers focused. That is what lets the destination be read at the end instead of frozen at the start.

Synthesized keystrokes are routed by the same rule, so the panel releases the keyboard before the transcription is typed; otherwise the text would be typed into the panel.

## What the panel is made of

The panel is a popover with the shell's own notification card inside it, which is what your notification list is when it holds a single message. The frame is the class GNOME's menus and Quick Settings wear, and it is a popover for one reason: a surface that floats over a window has to carry its own edge, and that is the class every theme gives one. The card inside it brings the header, the timestamp slot, the title, the body and the action buttons. Murmur's stylesheet sets five things - how wide the panel is, where it sits above the screen edge, how wide the level is, how tall the transcription may grow, and the header padding the shell reserves for a close button this card does not have. Everything else - colour, corner, border, shadow, font, and every button state - comes from the installed theme, so the panel follows the light and dark styles, the accent colour, high contrast, and a User Theme, without knowing any of them exist.

That division is not a preference. A declaration in an extension's stylesheet outranks the theme's, `!important` included, so any colour Murmur set would be a colour no theme could ever change.

The keyboard sits on **Stop** rather than on the panel itself, so the theme's focus ring marks the action `Enter` takes instead of outlining the whole surface for as long as it is open. `Esc` and `Ctrl+Enter` are taken before the focused button sees them, because a button in the shell activates on `Return` whatever modifier is held.

## Silence detection

When **Stop after silence** is on, every chunk of audio is measured before it is sent: the root mean square of its samples, as a fraction of full scale. Anything under 1% counts as silence, and silence is accumulated in *audio* time rather than wall-clock time, so a slow network or a backlog of buffered chunks can never look like a pause.

The same measurement drives the level in the panel, spread across the 50 decibels below full scale so that it moves the way loudness is heard rather than the way it is computed.

## Two processes, two halves of the code

A GNOME extension runs in two places, and they share nothing but files on disk:

| Process | Loads | In this repository |
| --- | --- | --- |
| GNOME Shell | Clutter, Meta, Shell, St | `src/extension.ts`, `src/lib/shell/` |
| The preferences window | Adw, Gdk, Gtk | `src/prefs.ts`, `src/lib/prefs/` |
| Both | Gio, GLib only | `src/lib/` |

Importing a shell type into the preferences, or a GTK type into the shell, crashes at load. `just lint` greps for exactly that and fails the build, so the boundary is enforced rather than remembered.

## How a dictation becomes words

Everything about a dictation that you can see - the microphone, the level, the silence, the panel, the destination, the insertion - is the same whichever service transcribes it. What differs is only how the audio travels, and there are two ways:

| | Streaming | One request |
| --- | --- | --- |
| Services | Grok, Mistral | OpenRouter |
| Carried by | A WebSocket held open for the dictation | One `POST` when the dictation ends |
| Audio sent as | PCM chunks as heard, raw or base64 | One 16 kHz mono WAV, built in memory |
| Panel during the dictation | The words so far | The level and the countdown |
| Bounded by | Ten seconds to open a session, five for the tail | A minute for the model to answer |

### OpenRouter

One `POST` to `openrouter.ai/api/v1/audio/transcriptions` carrying the chosen model's slug and the dictation as base64 WAV, answered with `{"text": …}`. The samples the microphone delivers are already what the models want, so the conversion is a 44-byte RIFF header in front of them. There is no streaming transcription API to use instead - the request is the whole protocol, which is also why nothing can appear in the panel until you stop.

### The realtime protocols

A streaming service is a WebSocket that eats raw audio and emits text, so each one is a single module that speaks its own protocol.

Mistral, with `voxtral-mini-realtime-latest`, streams text to append:

| Direction | Message | Meaning |
| --- | --- | --- |
| Up | `session.update` | Audio format and `target_streaming_delay_ms` |
| Up | `input_audio.append` | One base64 chunk of PCM |
| Up | `input_audio.flush`, `input_audio.end` | The microphone is done |
| Down | `transcription.text.delta` | More text, appended live |
| Down | `transcription.done` | The final transcription |
| Down | `error` | Reported to you as a notification |

Grok, with whichever model xAI serves by default, streams locked pieces placed by where they start in the audio, and guesses in between:

| Direction | Message | Meaning |
| --- | --- | --- |
| Up | The address | 16 kHz PCM, and that guesses are wanted: `?sample_rate=16000&encoding=pcm&interim_results=true` |
| Up | A binary frame | One chunk of PCM, raw |
| Up | `audio.done` | The microphone is done |
| Down | `transcript.created` | Audio may start |
| Down | `transcript.partial` with `is_final` false | A guess at the piece being said, revised as you carry on |
| Down | `transcript.partial` with `is_final` true | A locked piece, which supersedes the guess and whatever it starts at or before |
| Down | `transcript.done` | The final transcription; the socket closes after it |
| Down | `error` | Reported to you as a notification |

- **The audio is not JSON.** Every chunk goes up as the bytes the microphone wrote, in a binary frame, and the only text Murmur sends is `audio.done`.
- **A key it does not know never opens the socket.** The upgrade is answered with `400` and a reason in a body the WebSocket library does not hand over, so it reaches you as *the service refused the connection (400 Bad Request)*.

Both ends of a streamed dictation are bounded, so neither the panel nor the microphone can wait on a service forever: the audio waits ten seconds for a session to be opened for it, and the transcription's tail five seconds after the microphone closes. A dictation that ends before its session is open still reaches the service whole: the chunks held back go up first, and the end of the audio after them.

## How a recording becomes words

A recording is one file sent once, to each service's endpoint for files rather than its realtime one, as `multipart/form-data` with any fields first and the audio last, which is where xAI requires it. The audio part is named `recording.ogg`, because OpenAI's upload, which OpenRouter's follows, knows Ogg by that name and not by `.opus`.

| Service | Endpoint | Fields | Limit |
| --- | --- | --- | --- |
| Grok | `api.x.ai/v1/stt` | none | 500 MB a file |
| Mistral | `api.mistral.ai/v1/audio/transcriptions` | `model=voxtral-mini-latest`, Voxtral Mini Transcribe 2 | Three hours a request |
| OpenRouter | `openrouter.ai/api/v1/audio/transcriptions` | `model`, the one you picked | 25 MB an upload, and about a minute for the provider behind it |

Each answers with JSON whose `text` is the transcription, and that string is the transcript file, byte for byte. Nothing asks for speaker labels or timestamps, since nothing would show them. A request may go ten minutes without a byte moving either way before it counts as hung, which leaves a service room to transcribe hours before it answers.

## Built from TypeScript

`src/` is TypeScript, type-checked against the [GNOME Shell type definitions](https://github.com/gjsify/ts-for-gir), and compiled to plain GJS modules in `dist/`, which is what the shell loads. There is no bundler and no runtime dependency: the output is the same ES modules the shell would have loaded had they been written by hand.
