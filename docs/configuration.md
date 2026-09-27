# Configuration

Open the preferences from the *Extensions* app, or with:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

Every setting takes effect on the next dictation. Nothing needs a restart.

## Transcription

### Service

Which service transcribes your voice. Only the chosen one's settings are on screen; the others' keys stay where they are, so switching back is one click.

| | Gemini 3.5 Transcribe Live | Grok Voice Transcribe 2.0 | Mistral Voxtral Realtime | OpenRouter |
| --- | --- | --- | --- | --- |
| Key from | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | [console.x.ai](https://console.x.ai), once the account holds credit | [console.mistral.ai](https://console.mistral.ai) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Cost | Free on Google's free tier, which trains on your dictation; about $0.009 per minute when you pay | About $0.0033 per minute of audio, $0.20 an hour | About $0.006 per minute of audio | The model's own price, on its [model page](https://openrouter.ai/models?output_modalities=transcription) |
| Text appears | While you speak | While you speak | While you speak | When you stop |
| Longest recording | 10 minutes, which the service imposes | As long as you set; xAI publishes no session limit | As long as you set; Mistral ends no session of its own | 10 minutes |
| Own settings | **Tidy up what I say** | None | **Transcription delay** | **Model** |
| Language | Detected by the model, and it follows a switch mid-sentence | Detected by the model, and it follows a switch mid-recording | Detected by the model | Detected by the model |

Grok is the default, because it is the most accurate of the four while you speak - first on Artificial Analysis's English streaming benchmark in September 2026, with 2.7% of words wrong - and it ends no recording of its own. Its key works once the xAI account holds credit.

Gemini is the one that costs nothing, on Google's free tier. What that costs instead is [privacy](privacy.md#what-leaves-your-machine): Google's free tier states that it uses what you dictate to improve their products.

OpenRouter is one key for every transcription model it serves - Whisper, Deepgram Nova, Voxtral, Parakeet, and whatever it adds next. It has no streaming transcription API, so nothing appears in the panel while you speak: the recording is sent when you stop, and the words arrive a moment later. Everything else - the level, the countdown, the destination, the four keys - is unchanged.

### API key

Your key for the service above. Murmur does nothing without it and says so when you press the shortcut, naming the service it wants a key for.

It is stored like every other GNOME setting, in dconf, unencrypted. [Privacy](privacy.md) covers what that means.

### Tidy up what I say

Gemini only, on by default. The model cleans the transcription up: filler words dropped, spoken self-corrections resolved, lists and numbers formatted, capitalisation and punctuation polished. Turn it off to have what you said transcribed word for word.

The model's formatting includes line breaks, and a transcription is always one line, so a spoken list arrives with its bullets inline: `three things: - The report - The laptop`. Nothing Murmur types is an `Enter`.

### Model

OpenRouter only. Which of its transcription models does the work; **Meta: Muse Voice Transcribe 1.0** by default, a model built for push-to-talk dictation.

The list is fetched from OpenRouter when the preferences open, so a model added since your last update is in it. Without a network it lists only the model already set - the setting is a slug, so any model OpenRouter serves can be set by hand:

```bash
gsettings set org.gnome.shell.extensions.murmur openrouter-model openai/whisper-large-v3
```

What each one costs is on its page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription); Murmur does not show a price, because the models are priced by the hour, by the minute and by the token and the API does not say which.

### Transcription delay

Mistral only. How much audio Voxtral buffers before it transcribes. More context means better accuracy; less means text appears sooner.

| Preset | Value | Feels like |
| --- | --- | --- |
| Instant | 240 ms | Words appear almost as you say them, with more corrections |
| Fast | 500 ms | |
| Balanced | 1 s | |
| Accurate | 2.4 s | The default: noticeably behind your voice, and the steadiest result |

The delay does not slow down the finish: when you stop, Murmur waits for the tail of the transcription and inserts the whole thing.

## Recording

### Recording shortcut

Opens the panel and starts recording, then stops and delivers, the same as `Enter`. `Super+Space` by default. It is a system shortcut, so it works whatever is focused, including while the panel is collapsed.

### Show the panel when recording starts

Whether a recording opens the panel or begins collapsed. On by default.

| | |
| --- | --- |
| **On** | The panel opens at the bottom of the screen you are working on and holds the keyboard, so `Enter`, `Ctrl+Enter` and `Esc` control the recording straight away |
| **Off** | Nothing is drawn over your work. Only the recording indicator appears in the top bar; click it when you want to see the transcription |

Either way the rule is the same once a recording is running: the panel is on screen exactly while it holds the keyboard. Looking anywhere else collapses it to the top-bar indicator, and clicking that indicator brings it back with the keyboard.

### Maximum recording time

Seconds after which a recording ends on its own and delivers what it has. 600 by default. This is a safety net for a recording you walked away from, not a way to keep dictations short. The countdown shows in the panel and in the top-bar indicator, in hours once a recording runs past one.

How high it goes is the selected service's business, so the number you set is always the number the countdown starts at:

| Service | This row goes up to |
| --- | --- |
| Gemini 3.5 Transcribe Live | **600 seconds**, because Google ends a live transcription session at ten minutes |
| Grok Voice Transcribe 2.0 | **86400 seconds**, a day. xAI publishes no limit; the ceiling is Murmur declining to offer a recording with no end at all |
| Mistral Voxtral Realtime | **86400 seconds**, a day. Mistral imposes nothing; the ceiling is Murmur declining to offer a recording with no end at all |
| OpenRouter | **600 seconds**. The whole recording is sent in one request, so its length is also how much audio is held in memory and how much a model is asked to take at once |

Switching to Gemini with a longer time set lowers it to 600, and switching back to Grok or Mistral leaves it there.

### Stop after silence

Seconds of uninterrupted silence that end the recording. 0 keeps it running until you stop it yourself.

Silence is measured in audio time rather than wall-clock time, so a slow network cannot be mistaken for a pause. Anything quieter than roughly 1% of full scale counts as silence, so a noisy room may need a longer setting, or none.

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

Characters per second, 2500 by default: a sentence lands in a few hundredths of a second. At that speed no key is held at all, so the text goes in as fast as dotool can push it through.

Lower it if characters get dropped or reordered in a particular application, which some Electron and Java applications do under fast synthetic input.

## From the command line

Every setting is a GSettings key under `org.gnome.shell.extensions.murmur`, which makes them scriptable and easy to keep in dotfiles:

```bash
gsettings set org.gnome.shell.extensions.murmur transcription-provider xai
gsettings set org.gnome.shell.extensions.murmur xai-api-key "$(cat ~/.secrets/xai)"
gsettings set org.gnome.shell.extensions.murmur gemini-api-key "$(cat ~/.secrets/gemini)"
gsettings set org.gnome.shell.extensions.murmur gemini-smart-transcription true
gsettings set org.gnome.shell.extensions.murmur mistral-api-key "$(cat ~/.secrets/mistral)"
gsettings set org.gnome.shell.extensions.murmur openrouter-api-key "$(cat ~/.secrets/openrouter)"
gsettings set org.gnome.shell.extensions.murmur openrouter-model meta/muse-voice-transcribe-1.0
gsettings set org.gnome.shell.extensions.murmur remember-dictations false
gsettings set org.gnome.shell.extensions.murmur toggle-recording "['<Super>space']"
gsettings set org.gnome.shell.extensions.murmur show-panel-on-start false
gsettings set org.gnome.shell.extensions.murmur transcription-delay-ms 500
gsettings set org.gnome.shell.extensions.murmur max-recording-seconds 120
gsettings set org.gnome.shell.extensions.murmur silence-timeout-seconds 3
gsettings set org.gnome.shell.extensions.murmur typing-speed 500
```

| Key | Type | Default | Range |
| --- | --- | --- | --- |
| `gemini-api-key` | string | empty | |
| `gemini-smart-transcription` | boolean | `true` | |
| `max-recording-seconds` | integer | 600 | 15 to 86400, and to 600 in the preferences while Gemini or OpenRouter is selected |
| `mistral-api-key` | string | empty | |
| `openrouter-api-key` | string | empty | |
| `openrouter-model` | string | `meta/muse-voice-transcribe-1.0` | Any model slug OpenRouter transcribes with |
| `remember-dictations` | boolean | `true` | |
| `show-panel-on-start` | boolean | `true` | |
| `silence-timeout-seconds` | integer | 0 | 0 to 30 |
| `toggle-recording` | string list | `['<Super>space']` | |
| `transcription-delay-ms` | integer | 2400 | 240 to 2400 |
| `transcription-provider` | `gemini`, `mistral`, `openrouter` or `xai` | `xai` | |
| `typing-speed` | integer | 2500 | 50 to 2500 |
| `xai-api-key` | string | empty | |

A source install has to point `gsettings` at the schema it built, since it is not in the system directory:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/dist/schemas gsettings get org.gnome.shell.extensions.murmur typing-speed
```
