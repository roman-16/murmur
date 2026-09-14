# How it works

Murmur is a GNOME Shell extension, which means it runs inside the compositor itself. There is no daemon, no tray process and no companion service: the shortcut, the panel, the microphone, the network connection and the insertion are all the same process.

## One dictation, start to finish

1. **The shortcut fires.** `Super+Space` is a shell keybinding, active in the normal session and in the overview.
2. **The panel opens** at the bottom of the monitor holding the focused window - the pointer's monitor when nothing is focused - clear of anything docked there, showing the status, the level of your voice, a countdown, the destination, and the transcription as it arrives, alongside an indicator in the top bar. Nothing is grabbed: the panel is drawn as shell chrome and, unless it holds the keyboard, every click and keystroke goes where it would have anyway.
3. **The microphone opens.** `pw-record` is spawned and writes raw audio to a pipe: 16 kHz, mono, signed 16-bit little-endian, read in 100 ms chunks.
4. **The service is opened**, authenticated with your API key in a request header. A streaming service gets a WebSocket, told the audio format and whatever else it takes: the transcription delay, or the language and formatting mode. OpenRouter is opened by being sent the recording, so nothing happens here at all.
5. **The audio goes up.** Streaming, each chunk is base64-encoded in a JSON message as it is recorded; a service that has to finish its own setup first gets the chunks the moment it says it is ready, so no words are lost to the handshake. With OpenRouter the chunks are collected in memory instead. Nothing is buffered to disk either way.
6. **Text comes down** and appears in the panel immediately - from a streaming service, which is the only kind that has anything to say before you stop.
7. **You stop**, or silence or the time limit stops it for you. The microphone is released at once. A streaming connection stays open just long enough to collect the tail of the transcription; OpenRouter is sent the whole recording as a WAV and answers with the whole transcription.
8. **The destination is read**, now rather than at the start: whichever client holds a focused text field at this moment. See [Where the text goes](text-insertion.md).
9. **The panel releases the keyboard and closes**, and the text is delivered: typed into the focused field, or copied to the clipboard when there is none, which the panel says before it goes.
10. **The transcription is appended to the history**, `history.jsonl` in the extension's directory under `$XDG_STATE_HOME`, unless **Remember what I dictate** is off or the field was one the client reported as a password.

`Esc` cancels at any point. The subprocess is signalled, the socket is closed, and nothing is inserted or copied.

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

## How a recording becomes words

Everything about a dictation that you can see - the microphone, the level, the silence, the panel, the destination, the insertion - is the same whichever service transcribes it. What differs is only how the audio travels, and there are two ways:

| | Streaming | One request |
| --- | --- | --- |
| Services | Gemini, Mistral | OpenRouter |
| Carried by | A WebSocket held open for the recording | One `POST` when the recording ends |
| Audio sent as | Base64 PCM chunks, as recorded | One 16 kHz mono WAV, built in memory |
| Panel during the recording | The words so far | The level and the countdown |
| Bounded by | Ten seconds to open a session, five for the tail | A minute for the model to answer |

### OpenRouter

One `POST` to `openrouter.ai/api/v1/audio/transcriptions` carrying the chosen model's slug and the recording as base64 WAV, answered with `{"text": …}`. The samples `pw-record` writes are already what the models want, so the conversion is a 44-byte RIFF header in front of them. There is no streaming transcription API to use instead - the request is the whole protocol, which is also why nothing can appear in the panel until you stop.

### The realtime protocols

A streaming service is a WebSocket that eats raw audio and emits text, so each one is a single module that speaks its own protocol.

Mistral, with `voxtral-mini-transcribe-realtime-2602`, streams text to append:

| Direction | Message | Meaning |
| --- | --- | --- |
| Up | `session.update` | Audio format and `target_streaming_delay_ms` |
| Up | `input_audio.append` | One base64 chunk of PCM |
| Up | `input_audio.flush`, `input_audio.end` | The microphone is done |
| Down | `transcription.text.delta` | More text, appended live |
| Down | `transcription.done` | The final transcription |
| Down | `error` | Reported to you as a notification |

Gemini, with `gemini-3.5-transcribe-live`, streams guesses it later replaces:

| Direction | Message | Meaning |
| --- | --- | --- |
| Up | `setup` | The model, text output, automatic language detection, whether to tidy up, and that the turns are Murmur's to declare |
| Up | `realtimeInput.activityStart` | A dictation begins, sent with the first chunk of audio |
| Up | `realtimeInput.audio` | One base64 chunk of PCM |
| Up | `realtimeInput.activityEnd` | The microphone is done, so the turn is over |
| Down | `setupComplete` | Audio may start |
| Down | `serverContent.interimInputTranscription` | A guess at what is being said, revised as you carry on |
| Down | `serverContent.inputTranscription` | A finalised segment, which supersedes the guess |
| Down | `serverContent.generationComplete` | Generation finished; after the turn was closed, that is the transcription |

Four details of that one are worth writing down, because every one of them is invisible until it bites.

- **The turns are declared, not detected.** The service can find the edges of speech itself, and that is the arrangement its documentation recommends - but with its own detection left on, this endpoint accepts an entire dictation and transcribes none of it. Murmur knows when a dictation starts and stops anyway, so it says so: `activityStart` with the first chunk and `activityEnd` when the microphone closes.
- **Half a sample is a fatal argument.** A read from the microphone can end between the two bytes of a 16-bit sample, and a chunk carrying that half closes the connection with `1007 Request contains an invalid argument`, however small or large the chunks otherwise are. The odd byte waits for the one that completes it.
- **The JSON arrives in binary frames** as readily as in text ones, so the frame type says nothing about whether a message is for us.
- **The handshake succeeds whatever the key is.** A key the service rejects arrives as a socket closing with `1007` and a reason of its own words, which is why a close before the microphone was released is reported as an error rather than an empty transcription.

Both ends of a streamed dictation are bounded, so neither the panel nor the microphone can wait on a service forever: the audio waits ten seconds for a session to be opened for it, and the transcription's tail five seconds after the microphone closes.

## Built from TypeScript

`src/` is TypeScript, type-checked against the [GNOME Shell type definitions](https://github.com/gjsify/ts-for-gir), and compiled to plain GJS modules in `dist/`, which is what the shell loads. There is no bundler and no runtime dependency: the output is the same ES modules the shell would have loaded had they been written by hand.
