# Configuration

Open the preferences from the *Extensions* app, or with:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

Every setting takes effect on the next dictation or recording. Nothing needs a restart.

## Transcription

### Service

Which service transcribes your dictations and your recordings. Only the chosen one's settings are on screen; the others' keys stay where they are, so switching back is one click.

| | Grok | Mistral Voxtral | OpenRouter |
| --- | --- | --- | --- |
| Key from | [console.x.ai](https://console.x.ai), once the account holds credit | [console.mistral.ai](https://console.mistral.ai) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Dictation costs | About $0.20 an hour of audio | About $0.18 an hour of audio | The model's own price, on its [model page](https://openrouter.ai/models?output_modalities=transcription) |
| Recording costs | About $0.10 an hour of each channel with something on it | About $0.18 an hour of each channel with something on it | The same model, at the same price |
| Dictated text appears | While you speak | When you stop | When you stop |
| Longest dictation | As long as you set; xAI publishes no session limit | 10 minutes | 10 minutes |
| Longest recording | As long as you like | As long as you like | As long as you like |
| Speakers in a recording | Told apart | Told apart | Told apart by the models that can |
| Names and terms | The first 100, of up to 50 characters | The first 100 | The first 1000, of up to 100 characters, by the models that take them |
| Own settings | None | None | **Model** |
| Language | Detected by the model, and it follows a switch mid-dictation | Detected by the model | Detected by the model |

Mistral Voxtral is the default. Grok is the most accurate of the three while you speak - first on Artificial Analysis's English streaming benchmark in September 2026, with 2.7% of words wrong - costs less, and ends no dictation of its own. Its key works once the xAI account holds credit.

With Grok a dictation streams to its realtime model while you speak. With Mistral and OpenRouter it is sent when you stop, whole, and nothing appears in the panel until the words arrive a moment later; everything else - the level, the countdown, the destination, the keys - is the same. Mistral transcribes a dictation with Voxtral Mini Transcribe 2, the model it uses for recordings, which is half the price of its realtime one and takes your names and terms. It is sent in one request, so it ends after ten minutes.

A recording goes up when it stops, in pieces of at most ten minutes, to the service's model for files: Grok's own, Voxtral Mini Transcribe 2 with Mistral, and the model you picked with OpenRouter. Your microphone and what the computer plays are sent as separate requests, each billed for its own length, so a call where both sides talk throughout costs about twice what its length alone would; a channel with nothing on it for a whole piece is not sent.

OpenRouter is one key for every transcription model it serves - Whisper, Deepgram Nova, Voxtral, Parakeet, and whatever it adds next. It does not say which of them can tell speakers apart, time what they heard or take names and terms, so Murmur asks for all of it and gives up what a model turns away, one thing at a time, for the rest of the session. The providers behind it give a request about a minute, so a model slow on hours of audio can fail a long recording; its audio stays, for a **Retry** or another service.

### Names and terms

The names and words the people you dictate and record use, separated by commas and spelled the way a transcript should spell them: `Lukas, Valheim, Ashlands, Voxtral`. **Apply** or `Enter` saves them.

They go to the service with every dictation, recording and file, and the service leans towards them where it hears something close. That is a nudge, not a guarantee. Each service takes only so many:

| Service | Takes |
| --- | --- |
| Grok | The first 100, each up to 50 characters; a longer one is left out |
| Mistral | The first 100. Mistral writes a phrase with underscores where its words meet, so `Ashlands boss` goes as `Ashlands_boss`. Mistral tunes this for English, and calls it experimental in other languages |
| OpenRouter | The first 1000, each up to 100 characters, to a model that takes them. A model that does not is asked again without them |

Leave it empty and nothing is sent.

### API key

Your key for the service above. Murmur does nothing without it and says so when you press either shortcut, naming the service it wants a key for.

It is stored like every other GNOME setting, in dconf, unencrypted. [Privacy](privacy.md) covers what that means.

### Model

OpenRouter only. Which of its transcription models does the work, for dictations and recordings alike; **Meta: Muse Voice Transcribe 1.0** by default, a model built for push-to-talk dictation.

The list is fetched from OpenRouter when the preferences open, so a model added since your last update is in it. Without a network it lists only the model already set - the setting is a slug, so any model OpenRouter serves can be set by hand:

```bash
gsettings set org.gnome.shell.extensions.murmur openrouter-model openai/whisper-large-v3
```

What each one costs is on its page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription); Murmur does not show a price, because the models are priced by the hour, by the minute and by the token and the API does not say which.

## Dictation

### Dictation shortcut

Opens the panel and starts listening, then stops and delivers, the same as `Enter`. `Super+Space` by default. It is a system shortcut, so it works whatever is focused, including while the panel is collapsed.

### Show the panel when a dictation starts

Whether a dictation opens the panel or begins collapsed. On by default.

| | |
| --- | --- |
| **On** | The panel opens at the bottom of the screen you are working on and holds the keyboard, so `Enter`, `Ctrl+Enter` and `Esc` control the dictation straight away |
| **Off** | Nothing is drawn over your work. Only the indicator appears in the top bar; click it when you want to see the transcription |

Either way the rule is the same once a dictation is running: the panel is on screen exactly while it holds the keyboard. Looking anywhere else collapses it to the top-bar indicator, and clicking that indicator brings it back with the keyboard.

### Maximum dictation time

Seconds after which a dictation ends on its own and delivers what it has. 600 by default. This is a safety net for a dictation you walked away from, not a way to keep dictations short. The countdown shows in the panel and in the top-bar indicator, in hours once a dictation runs past one.

How high it goes is the selected service's business, so the number you set is always the number the countdown starts at:

| Service | This row goes up to |
| --- | --- |
| Grok | **86400 seconds**, a day. xAI publishes no limit; the ceiling is Murmur declining to offer a dictation with no end at all |
| Mistral Voxtral | **600 seconds**. The whole dictation is sent in one request, so its length is also how much audio is held in memory and how much the model is asked to take at once, and Mistral has turned away 35 minutes in one request |
| OpenRouter | **600 seconds**, for the same reason |

Switching to Mistral or OpenRouter with a longer time set lowers it to 600, and switching back to Grok leaves it there.

### Stop after silence

Seconds of uninterrupted silence that end a dictation. 0 keeps it listening until you stop it yourself.

Silence is measured in audio time rather than wall-clock time, so a slow network cannot be mistaken for a pause. Anything quieter than roughly 1% of full scale counts as silence, so a noisy room may need a longer setting, or none.

## Recording

### Recording shortcut

Starts recording everything the computer plays and the microphone hears, then stops and transcribes it. `Super+Alt+Space` by default, and a system shortcut like the dictation's, except on the lock screen, where no shortcut of Murmur's is listening.

The audio and the transcript are saved side by side in the **Recordings folder**. The audio is Ogg Opus in two channels at 48 kbit/s: your microphone on the left and everything the computer plays on the right, so you hear yourself in one ear and the call in the other. The transcript has a line for each thing said, with the time of day it was said and who said it:

```markdown
19:33:52 Roman: Hast du den Link geschickt?

19:33:55 Speaker 1: Ja, schau in den Chat.

19:34:01 Speaker 2: I can't hear you guys.
```

What came in on the microphone carries your name, as the account's settings give it. The voices on the desktop's channel are numbered in the order they first speak; a line the service could not give to anyone reads `Others`. Each channel is transcribed on its own, so two people talking at once are two lines.

A recording runs until you stop it, and has no silence stop, since a call has silences in it.

### Recordings folder

Where a recording's audio and transcript are saved, `~/Documents/Murmur` by default. **Choose** picks a folder, and **Reset** goes back to the default. The folder is created on the first recording if it does not exist yet.

The folder is read as a recording starts, so a recording stays where it started even when the folder changes while it runs, and its notifications name the folder it is in. From the command line, a path starting with `~/` is in your home folder.

### Transcribe a file

Transcribes an audio file you choose - a recording again, or audio from anywhere else, in any format GStreamer plays - with the service picked beside it. The list holds the services that have a key, and follows **Service** until you pick another. The file chooser opens in the recordings folder.

The transcript is saved beside the audio under the same name, `interview.md` for `interview.m4a`. When one is already there, Murmur asks before replacing it, and replaces it only once the new transcript is done. The file is transcribed the way a recording is, with its pill, its notification and **Retry**, and billed the same.

A recording of Murmur's is told apart by channel as above. Any other file, one without Murmur's two channels, is heard as one track: every voice is numbered, and the time counts from `00:00:00` unless the file is named the way Murmur names a recording, in which case it is the time of day.

The same service gives the same words for the same audio, so a recording transcribed again by the service that got it wrong mostly comes back wrong the same way. Pick another service, or another OpenRouter model.

A script can ask for the same thing over D-Bus, with the file's full path and `mistral`, `openrouter` or `xai`:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/Murmur --method org.gnome.Shell.Extensions.Murmur.Transcribe ~/Downloads/interview.m4a xai
```

It answers `()` once the transcription has started, or with the reason it refused: a file that is not there or is not audio, a service with no key, the recording still running, or a file already being transcribed.

## History

### Remember what I dictate

On by default. The text of every finished dictation is appended to `~/.local/state/murmur@roman-16.github.io/history.jsonl`, in plain text, and listed on the **History** page.

- **Click a dictation to copy it** to the clipboard.
- **Search** them from the magnifier in the window's header.
- **Clear history** deletes the file, after asking.
- The newest **500** are kept; older ones fall off the end.
- A field the application reports as a password is never kept, nor is a dictation you cancelled with `Esc`. XWayland applications report nothing, so a password dictated into one would be kept.

Turn the switch off and nothing further is written. What is already there stays until you clear it, and uninstalling does not remove it:

```bash
rm -r ~/.local/state/murmur@roman-16.github.io
```

## Text insertion

### dotool status

Not a setting but a live check, with a refresh button. It reports whether Murmur can type with dotool, and names the reason when it cannot: dotool missing, `/dev/uinput` missing, your user not in the right group, or a group membership that needs a fresh login. See [Where the text goes](text-insertion.md).

Without it Murmur falls back to the shell's virtual keyboard, which reaches every application too but only with characters from your current keyboard layout.

### Typing speed

Characters per second, 2000 by default: a sentence lands in a few hundredths of a second. The choices are 10, 20, 50, 100, 200, 500, 1000, 2000 and 5000, and each is the speed the text really goes in at, with dotool and without it. Above a thousand a second no key is held at all.

Lower it if characters get dropped or reordered in a particular application, which some Electron and Java applications do under fast synthetic input.

## From the command line

Every setting is a GSettings key under `org.gnome.shell.extensions.murmur`, which makes them scriptable and easy to keep in dotfiles:

```bash
gsettings set org.gnome.shell.extensions.murmur transcription-provider xai
gsettings set org.gnome.shell.extensions.murmur xai-api-key "$(cat ~/.secrets/xai)"
gsettings set org.gnome.shell.extensions.murmur mistral-api-key "$(cat ~/.secrets/mistral)"
gsettings set org.gnome.shell.extensions.murmur openrouter-api-key "$(cat ~/.secrets/openrouter)"
gsettings set org.gnome.shell.extensions.murmur openrouter-model meta/muse-voice-transcribe-1.0
gsettings set org.gnome.shell.extensions.murmur names-and-terms "['Lukas', 'Valheim', 'Ashlands']"
gsettings set org.gnome.shell.extensions.murmur remember-dictations false
gsettings set org.gnome.shell.extensions.murmur toggle-dictation "['<Super>space']"
gsettings set org.gnome.shell.extensions.murmur toggle-recording "['<Super><Alt>space']"
gsettings set org.gnome.shell.extensions.murmur recording-folder '~/Notes/Calls'
gsettings set org.gnome.shell.extensions.murmur show-panel-on-start false
gsettings set org.gnome.shell.extensions.murmur max-dictation-seconds 120
gsettings set org.gnome.shell.extensions.murmur silence-timeout-seconds 3
gsettings set org.gnome.shell.extensions.murmur typing-speed 500
```

| Key | Type | Default | Range |
| --- | --- | --- | --- |
| `max-dictation-seconds` | integer | 600 | 15 to 86400, and to 600 in the preferences while Mistral or OpenRouter is selected |
| `mistral-api-key` | string | empty | |
| `names-and-terms` | string list | empty | |
| `openrouter-api-key` | string | empty | |
| `openrouter-model` | string | `meta/muse-voice-transcribe-1.0` | Any model slug OpenRouter transcribes with |
| `recording-folder` | string | `~/Documents/Murmur` | Any folder; a leading `~` is your home folder |
| `remember-dictations` | boolean | `true` | |
| `show-panel-on-start` | boolean | `true` | |
| `silence-timeout-seconds` | integer | 0 | 0 to 30 |
| `toggle-dictation` | string list | `['<Super>space']` | |
| `toggle-recording` | string list | `['<Super><Alt>space']` | |
| `transcription-provider` | `mistral`, `openrouter` or `xai` | `mistral` | |
| `typing-speed` | integer | 2000 | 10 to 5000 |
| `xai-api-key` | string | empty | |

A source install has to point `gsettings` at the schema it built, since it is not in the system directory:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/dist/schemas gsettings get org.gnome.shell.extensions.murmur typing-speed
```
