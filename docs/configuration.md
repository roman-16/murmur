# Configuration

Open the preferences from the *Extensions* app, or with:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

Every setting takes effect on the next dictation. Nothing needs a restart.

## Transcription

### Mistral API key

Your key for the Voxtral realtime endpoint. Murmur does nothing without it and says so when you press the shortcut.

It is stored like every other GNOME setting, in dconf, unencrypted. [Privacy](privacy.md) covers what that means.

### Transcription delay

How much audio Voxtral buffers before it transcribes. More context means better accuracy; less means text appears sooner.

| Preset | Value | Feels like |
| --- | --- | --- |
| Instant | 240 ms | Words appear almost as you say them, with more corrections |
| Fast | 500 ms | |
| Balanced | 1 s | The default |
| Accurate | 2.4 s | Noticeably behind your voice, and the steadiest result |

The delay does not slow down the finish: when you stop, Murmur waits for the tail of the transcription and inserts the whole thing.

## Recording

### Recording shortcut

Opens the overlay and starts recording, then stops and delivers, the same as `Enter`. `Super+Space` by default.

### Maximum recording time

Seconds after which a recording ends on its own and delivers what it has. 120 by default, between 15 and 1800. This is a safety net for a recording you walked away from, not a way to keep dictations short.

### Stop after silence

Seconds of uninterrupted silence that end the recording. 0 keeps it running until you stop it yourself.

Silence is measured in audio time rather than wall-clock time, so a slow network cannot be mistaken for a pause. Anything quieter than roughly 1% of full scale counts as silence, so a noisy room may need a longer setting, or none.

## Text insertion

### dotool status

Not a setting but a live check, with a refresh button. It reports whether Murmur can type into XWayland applications, and names the reason when it cannot: dotool missing, `/dev/uinput` missing, your user not in the right group, or a group membership that needs a fresh login. See [Where the text goes](text-insertion.md).

Wayland applications do not need dotool at all.

### Typing speed

Characters per second for the typing path, 500 by default. It has no effect when text is inserted through the input method, which happens in one go.

Lower it if characters get dropped or reordered in a particular application, which some Electron and Java applications do under fast synthetic input.

## From the command line

Every setting is a GSettings key under `org.gnome.shell.extensions.murmur`, which makes them scriptable and easy to keep in dotfiles:

```bash
gsettings set org.gnome.shell.extensions.murmur mistral-api-key "$(cat ~/.secrets/mistral)"
gsettings set org.gnome.shell.extensions.murmur toggle-recording "['<Super>space']"
gsettings set org.gnome.shell.extensions.murmur transcription-delay-ms 500
gsettings set org.gnome.shell.extensions.murmur max-recording-seconds 120
gsettings set org.gnome.shell.extensions.murmur silence-timeout-seconds 3
gsettings set org.gnome.shell.extensions.murmur typing-speed 500
```

| Key | Type | Default | Range |
| --- | --- | --- | --- |
| `max-recording-seconds` | integer | 120 | 15 to 1800 |
| `mistral-api-key` | string | empty | |
| `silence-timeout-seconds` | integer | 0 | 0 to 30 |
| `toggle-recording` | string list | `['<Super>space']` | |
| `transcription-delay-ms` | integer | 1000 | 240 to 2400 |
| `typing-speed` | integer | 500 | 50 to 1000 |

A source install has to point `gsettings` at the schema it built, since it is not in the system directory:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/dist/schemas gsettings get org.gnome.shell.extensions.murmur typing-speed
```
