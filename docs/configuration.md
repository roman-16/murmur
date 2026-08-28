# Configuration

Open the preferences from the *Extensions* app, or with:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

Every setting takes effect on the next dictation. Nothing needs a restart.

## Transcription

### Service

Which service transcribes your voice. Only the chosen one's settings are on screen; the other's key stays where it is, so switching back is one click.

| | Mistral Voxtral Realtime | Gemini 3.5 Transcribe Live |
| --- | --- | --- |
| Key from | [console.mistral.ai](https://console.mistral.ai) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Cost | About $0.006 per minute of audio | Free on Google's free tier, which trains on your dictation; about $0.009 per minute when you pay |
| Longest recording | 30 minutes, the cap you set | 10 minutes, which the service imposes |
| Own settings | **Transcription delay** | **Tidy up what I say** |
| Language | Detected by the model | Detected by the model, and it follows a switch mid-sentence |

Gemini is the default, because a free key transcribes as much as you like. What that costs instead is [privacy](privacy.md#what-leaves-your-machine): Google's free tier states that it uses what you dictate to improve their products.

### API key

Your key for the service above. Murmur does nothing without it and says so when you press the shortcut, naming the service it wants a key for.

It is stored like every other GNOME setting, in dconf, unencrypted. [Privacy](privacy.md) covers what that means.

### Tidy up what I say

Gemini only, on by default. The model cleans the transcription up: filler words dropped, spoken self-corrections resolved, lists and numbers formatted, capitalisation and punctuation polished. Turn it off to have what you said transcribed word for word.

The model's formatting includes line breaks, and a transcription is always one line, so a spoken list arrives with its bullets inline: `three things: - The report - The laptop`. Nothing Murmur types is an `Enter`.

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
| **On** | The panel opens at the bottom of the screen you are working on and holds the keyboard, so `Enter`, `Ctrl+Enter`, `Esc` and the scrolling keys control the recording straight away |
| **Off** | Nothing is drawn over your work. Only the recording indicator appears in the top bar; click it when you want to see the transcription |

Either way the rule is the same once a recording is running: the panel is on screen exactly while it holds the keyboard. Looking anywhere else collapses it to the top-bar indicator, and clicking that indicator brings it back with the keyboard.

### Maximum recording time

Seconds after which a recording ends on its own and delivers what it has. 600 by default, between 15 and 1800. This is a safety net for a recording you walked away from, not a way to keep dictations short. The countdown shows in the panel and in the top-bar indicator.

With Gemini selected the countdown starts at ten minutes however high this is set, because Google ends a live transcription session there.

### Stop after silence

Seconds of uninterrupted silence that end the recording. 0 keeps it running until you stop it yourself.

Silence is measured in audio time rather than wall-clock time, so a slow network cannot be mistaken for a pause. Anything quieter than roughly 1% of full scale counts as silence, so a noisy room may need a longer setting, or none.

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
gsettings set org.gnome.shell.extensions.murmur transcription-provider gemini
gsettings set org.gnome.shell.extensions.murmur gemini-api-key "$(cat ~/.secrets/gemini)"
gsettings set org.gnome.shell.extensions.murmur gemini-smart-transcription true
gsettings set org.gnome.shell.extensions.murmur mistral-api-key "$(cat ~/.secrets/mistral)"
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
| `max-recording-seconds` | integer | 600 | 15 to 1800 |
| `mistral-api-key` | string | empty | |
| `show-panel-on-start` | boolean | `true` | |
| `silence-timeout-seconds` | integer | 0 | 0 to 30 |
| `toggle-recording` | string list | `['<Super>space']` | |
| `transcription-delay-ms` | integer | 2400 | 240 to 2400 |
| `transcription-provider` | `gemini` or `mistral` | `gemini` | |
| `typing-speed` | integer | 2500 | 50 to 2500 |

A source install has to point `gsettings` at the schema it built, since it is not in the system directory:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/dist/schemas gsettings get org.gnome.shell.extensions.murmur typing-speed
```
