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
| Dictation costs | About $0.20 an hour of audio | About $0.36 an hour of audio | The model's own price, on its [model page](https://openrouter.ai/models?output_modalities=transcription) |
| Recording costs | About $0.10 an hour of audio | About $0.18 an hour of audio | The same model, at the same price |
| Dictated text appears | While you speak | While you speak | When you stop |
| Longest dictation | As long as you set; xAI publishes no session limit | As long as you set; Mistral ends no session of its own | 10 minutes |
| Longest recording | As long as you like; a file can be 500 MB, which is nearly two days of this audio | 3 hours, which Voxtral Mini Transcribe 2 takes in one request | 2 hours, since an upload can be 25 MB |
| Own settings | None | **Transcription delay** | **Model** |
| Language | Detected by the model, and it follows a switch mid-dictation | Detected by the model | Detected by the model |

Mistral Voxtral is the default. Grok is the most accurate of the three while you speak - first on Artificial Analysis's English streaming benchmark in September 2026, with 2.7% of words wrong - costs less, and ends neither a dictation nor a recording of its own. Its key works once the xAI account holds credit.

A dictation streams to the service's realtime model while you speak. A recording goes up in one request when it stops, to the same service's model for files: Grok's own, Voxtral Mini Transcribe 2 with Mistral, and the model you picked with OpenRouter.

OpenRouter is one key for every transcription model it serves - Whisper, Deepgram Nova, Voxtral, Parakeet, and whatever it adds next. It has no streaming transcription API, so nothing appears in the panel while you speak: the dictation is sent when you stop, and the words arrive a moment later. Everything else - the level, the countdown, the destination, the keys - is unchanged. The providers behind it give a request about a minute, so a model slow on hours of audio can fail a long recording; its audio stays, for a **Retry** or another service.

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

### Transcription delay

Mistral only, and dictation only. How much audio Voxtral buffers before it transcribes. More context means better accuracy; less means text appears sooner.

| Preset | Value | Feels like |
| --- | --- | --- |
| Instant | 240 ms | Words appear almost as you say them, with more corrections |
| Fast | 500 ms | |
| Balanced | 1 s | |
| Accurate | 2.4 s | The default: noticeably behind your voice, and the steadiest result |

The delay does not slow down the finish: when you stop, Murmur waits for the tail of the transcription and inserts the whole thing.

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
| Mistral Voxtral | **86400 seconds**, a day. Mistral imposes nothing; the ceiling is Murmur declining to offer a dictation with no end at all |
| OpenRouter | **600 seconds**. The whole dictation is sent in one request, so its length is also how much audio is held in memory and how much a model is asked to take at once |

Switching to OpenRouter with a longer time set lowers it to 600, and switching back to Grok or Mistral leaves it there.

### Stop after silence

Seconds of uninterrupted silence that end a dictation. 0 keeps it listening until you stop it yourself.

Silence is measured in audio time rather than wall-clock time, so a slow network cannot be mistaken for a pause. Anything quieter than roughly 1% of full scale counts as silence, so a noisy room may need a longer setting, or none.

## Recording

### Recording shortcut

Starts recording everything the computer plays and the microphone hears, then stops and transcribes it. `Super+Alt+Space` by default, and a system shortcut like the dictation's, except on the lock screen, where no shortcut of Murmur's is listening.

The audio and the transcript are saved side by side in the `Murmur` folder of your Documents folder, `~/Documents/Murmur` unless your desktop names Documents something else. That is not a setting. The transcript is exactly what the service returned, and the audio is Ogg Opus, mono, at 24 kbit/s.

A recording has no settings of its own beyond the shortcut: it runs until you stop it, or until the service's limit in the table above, and has no silence stop, since a call has silences in it.

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
gsettings set org.gnome.shell.extensions.murmur remember-dictations false
gsettings set org.gnome.shell.extensions.murmur toggle-dictation "['<Super>space']"
gsettings set org.gnome.shell.extensions.murmur toggle-recording "['<Super><Alt>space']"
gsettings set org.gnome.shell.extensions.murmur show-panel-on-start false
gsettings set org.gnome.shell.extensions.murmur transcription-delay-ms 500
gsettings set org.gnome.shell.extensions.murmur max-dictation-seconds 120
gsettings set org.gnome.shell.extensions.murmur silence-timeout-seconds 3
gsettings set org.gnome.shell.extensions.murmur typing-speed 500
```

| Key | Type | Default | Range |
| --- | --- | --- | --- |
| `max-dictation-seconds` | integer | 600 | 15 to 86400, and to 600 in the preferences while OpenRouter is selected |
| `mistral-api-key` | string | empty | |
| `openrouter-api-key` | string | empty | |
| `openrouter-model` | string | `meta/muse-voice-transcribe-1.0` | Any model slug OpenRouter transcribes with |
| `remember-dictations` | boolean | `true` | |
| `show-panel-on-start` | boolean | `true` | |
| `silence-timeout-seconds` | integer | 0 | 0 to 30 |
| `toggle-dictation` | string list | `['<Super>space']` | |
| `toggle-recording` | string list | `['<Super><Alt>space']` | |
| `transcription-delay-ms` | integer | 2400 | 240 to 2400 |
| `transcription-provider` | `mistral`, `openrouter` or `xai` | `mistral` | |
| `typing-speed` | integer | 2000 | 10 to 5000 |
| `xai-api-key` | string | empty | |

A source install has to point `gsettings` at the schema it built, since it is not in the system directory:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/dist/schemas gsettings get org.gnome.shell.extensions.murmur typing-speed
```
