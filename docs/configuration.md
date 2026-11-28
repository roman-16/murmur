# Configuration

Open the preferences from the *Extensions* app, or with:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

The window has four pages - **Transcription**, **Dictation**, **Recording** and **History** - and the sections below follow them. Every setting takes effect on the next dictation or recording. Nothing needs a restart.

## Transcription

### Service

Which service transcribes your dictations and your recordings. Only the chosen one's settings are on screen; the others' keys and models stay where they are, so switching back is one click.

| | Grok | Mistral Voxtral | OpenRouter | This computer |
| --- | --- | --- | --- | --- |
| Key from | [console.x.ai](https://console.x.ai), once the account holds credit | [console.mistral.ai](https://console.mistral.ai) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | No key: Python 3, the engine and a speech model file of your own |
| Dictation costs | About $0.20 an hour of audio | About $0.24 an hour of audio | The model's own price, on its [model page](https://openrouter.ai/models?output_modalities=transcription) | Nothing |
| Recording costs | About $0.10 an hour of each channel with something on it | About $0.24 an hour of each channel with something on it | The same model, at the same price | Nothing |
| Dictated text appears | While you speak | When you stop | When you stop | While you speak with a model that streams, otherwise when you stop |
| Longest dictation | As long as you set; xAI publishes no session limit | 10 minutes | 10 minutes | 10 minutes |
| Longest recording | As long as you like | As long as you like | As long as you like | As long as you like |
| Speakers in a recording | Told apart | Told apart | Told apart by the models that can | Told apart, up to four in each piece |
| Names and terms | The first 100, of up to 50 characters | All of them | The first 1000, of up to 100 characters, by the models that take them | All of them, by the models that use them |
| Own settings | None | None | **Model** | **Engine**, **Model**, and whatever the model takes |
| Language | Detected by the model, and it follows a switch mid-dictation | Detected by the model | Detected by the model | Detected by the model, or set under **Language** |

Mistral Voxtral is the default. Grok is the most accurate of the three while you speak - first on Artificial Analysis's English streaming benchmark in September 2026, with 2.7% of words wrong - costs less, and ends no dictation of its own. Its key works once the xAI account holds credit.

With Grok a dictation streams to its realtime model while you speak. With Mistral and OpenRouter it is sent when you stop, whole, and nothing appears in the panel until the words arrive a moment later; everything else - the level, the countdown, the destination, the keys - is the same. Mistral transcribes a dictation with Voxtral Small Transcribe 3, the model it uses for recordings, which is half the price of its realtime one and takes your names and terms. It is sent in one request, so it ends after ten minutes.

A recording goes up when it stops, in pieces of at most the [**Piece length**](#piece-length), ten minutes by default, to the service's model for files: Grok's own, Voxtral Small Transcribe 3 with Mistral, and the model you picked with OpenRouter. Your microphone and what the computer plays are sent as separate requests, each billed for its own length, so a call where both sides talk throughout costs about twice what its length alone would; a channel with nothing on it for a whole piece is not sent.

OpenRouter is one key for every transcription model it serves - Whisper, Deepgram Nova, Voxtral, Parakeet, and whatever it adds next. It does not say which of them can tell speakers apart, time what they heard or take names and terms, so Murmur asks for all of it and gives up what a model turns away, one thing at a time, for the rest of the session. The providers behind it give a request about a minute, so a model slow on a ten-minute piece can fail a recording; its audio stays, for a **Retry** with a shorter [**Piece length**](#piece-length), or another service.

This computer sends nothing anywhere: a speech model you choose, a GGUF file, runs on your own graphics card, or on the processor where there is none. See [This computer](#this-computer) below.

### Names and terms

The names and words the people you dictate and record use, spelled the way a transcript should spell them. The row opens their list: type one into **Add a name or term** and press `Enter`, or several at once separated by commas, `Lukas, Valheim, Ashlands, Voxtral`. One already in the list is not added twice. The **−** button beside a term removes it, and **Undo** on the toast puts it back.

They are sent in the order listed, which decides which of them a service that takes only so many receives.

They go to the service with every dictation, recording and file, and the service leans towards them where it hears something close. That is a nudge, not a guarantee. Each service takes only so many:

| Service | Takes |
| --- | --- |
| Grok | The first 100, each up to 50 characters; a longer one is left out |
| Mistral | All of them, as written: `Ashlands boss` goes as `Ashlands boss` |
| OpenRouter | The first 1000, each up to 100 characters, to a model that takes them. A model that does not is asked again without them |
| This computer | All of them, to a model that uses them. Under **Model**, one that does not says it ignores names and terms. A model that streams may leave them out of the words it shows as you speak |

Leave the list empty and nothing is sent.

### API key

Your key for the service above; This computer needs none. Murmur does nothing without it and says so when you press either shortcut, naming the service it wants a key for.

It is stored like every other GNOME setting, in dconf, unencrypted. [Privacy](privacy.md) covers what that means.

### Model

OpenRouter only. Which of its transcription models does the work, for dictations and recordings alike; **Meta: Muse Voice Transcribe 1.0** by default, a model built for push-to-talk dictation.

The list is fetched from OpenRouter when the preferences open, so a model added since your last update is in it. Without a network it lists only the model already set - the setting is a slug, so any model OpenRouter serves can be set by hand:

```bash
gsettings set org.gnome.shell.extensions.murmur openrouter-model openai/whisper-large-v3
```

What each one costs is on its page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription); Murmur does not show a price, because the models are priced by the hour, by the minute and by the token and the API does not say which.

### This computer

The service that transcribes on your own computer. It runs an engine, [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp), and a speech model you choose, and nothing you say leaves the machine.

**Engine** says which engine is installed and what it runs on: `transcribe.cpp 0.5.0, on the NVIDIA GeForce RTX 4070 SUPER`, or `on the processor` without a graphics card it can use. The engine is not part of the extension, which extensions.gnome.org forbids, so the row offers **Download** the first time: 163 MB from PyPI and Hugging Face, once, into `~/.local/share/murmur@roman-16.github.io/engine/`. Closing the preferences stops a download, and **Download** starts it again. It needs Python 3.9 or later, which the row asks for when it is missing. Installed with Nix, the engine comes with the package and there is nothing to download.

With the engine come two small models of its own, which Murmur uses on every recording whatever model you choose: one that finds where speech is, so every model's lines are timed, and one that tells the voices on a call apart.

**Model** is the speech model, a `.gguf` file anywhere on your computer: the folder button opens a file chooser. Any model the engine runs will do - Whisper, Parakeet, Canary, Qwen3-ASR, Voxtral, Cohere Transcribe, Granite Speech, Moonshine, SenseVoice and more; ready files for all of them are at [huggingface.co/handy-computer](https://huggingface.co/handy-computer). Choosing one tries it first, on the graphics card, which also prepares the card for it, so the first dictation does not wait for that. A file the engine cannot run, a chat model's for one, is refused with a toast and the previous model stays. The row then names the file and what the model is: its languages, whether it streams, and whether it ignores your names and terms.

Below it are the model's own settings: exactly the ones the engine says this model takes, and kept for each model file separately, so switching back to a model brings its settings back.

- **Language**, for a model that speaks more than one: **Automatic** detects it, or pick the one you speak.
- **Words as you speak**, for a model that streams: the panel shows the words while you talk, as with Grok. Off, the model hears the whole dictation when you stop.
- **Wait for settled words**, under it: the panel shows a word only once the model has stopped revising it, so the text is steadier and a little later.
- **Punctuation** and **Numbers as digits**, for a model that can turn either off or on.
- **Model settings**: the settings of the model's family, by the engine's own names - a lookahead in milliseconds for one, a temperature for another. Each says **Automatic** until you change it, and the undo button sets it back. A setting marked *Only while words appear as you speak* changes nothing in a recording.

A value is tried on the model when you set it, and one the model refuses is not kept: the row says what the engine said, `The model refused it: invalid argument`.

A dictation starts the engine when you press the shortcut, so the model loads while you speak, and the engine is gone again once the words are in. A recording is transcribed one piece at a time, since every piece loads the model onto the same graphics card. When the card has no memory left, the engine carries on with the processor, more slowly, rather than lose the words.

## Dictation

### Dictation shortcut

Opens the panel and starts listening, then stops and delivers, the same as `Enter`. `Super+Space` by default. It is a system shortcut, so it works whatever is focused, including while the panel is collapsed. Holding it down counts as one press.

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
| Mistral Voxtral | **600 seconds**. The whole dictation is sent in one request, so its length is also how much audio is held in memory and how much the model is asked to take at once, and Mistral turns away a request whose audio and names and terms together outrun its model's context |
| OpenRouter | **600 seconds**, for the same reason |
| This computer | **600 seconds**. A model that does not stream hears the whole dictation at once, and the engine holds all of it until then |

Switching to Mistral, OpenRouter or This computer with a longer time set lowers it to 600, and switching back to Grok leaves it there.

### Stop after silence

Seconds of uninterrupted silence that end a dictation. 0 keeps it listening until you stop it yourself.

Silence is measured in audio time rather than wall-clock time, so a slow network cannot be mistaken for a pause. Anything quieter than roughly 1% of full scale counts as silence, so a noisy room may need a longer setting, or none.

### Text insertion

Not a setting but a live check, at the top of the **Text insertion** group. **Typing with dotool** means Murmur types with dotool. **Typing with the virtual keyboard** means it cannot, and the row names the reason - dotool missing, `/dev/uinput` missing, your user not in the right group, or a group membership that needs a fresh login - beside a refresh button and a help button that opens [the dotool section](text-insertion.md#dotool) of Where the text goes.

The virtual keyboard reaches every application too, but only with characters from your current keyboard layout.

### Typing speed

Characters per second, 2000 by default: a sentence lands in a few hundredths of a second. The choices are 10, 20, 50, 100, 200, 500, 1000, 2000 and 5000, and each is the speed the text really goes in at, with dotool and without it. Above a thousand a second no key is held at all.

Lower it if characters get dropped or reordered in a particular application, which some Electron and Java applications do under fast synthetic input.

## Recording

### Recording shortcut

Starts recording everything the computer plays and the microphone hears, then stops and transcribes it. `Super+Alt+Space` by default, and a system shortcut like the dictation's, except on the lock screen, where no shortcut of Murmur's is listening.

The audio and the transcript are saved side by side in the **Recordings folder**. The audio is Ogg Opus in two channels at 48 kbit/s: your microphone on the left and everything the computer plays on the right, so you hear yourself in one ear and the call in the other. The transcript opens with where and when it was recorded, then has a line for each thing said, with the time of day it was said and who said it, among lines for what went on around it, which [**Note what is on screen and playing**](#note-what-is-on-screen-and-playing) describes:

```markdown
---
computer: roman-laptop
day: Thursday
ended: 2026-03-26T20:12:40
microphone: Jabra Evolve2 65 Mono
network: Home
output: Jabra Evolve2 65 Stereo
started: 2026-03-26T19:33:40
transcribed-by: Mistral Voxtral (voxtral-small-transcribe-3)
---
19:33:40 [focused] Discord: "#general | Valheim crew - Discord"
19:33:40 [playing] Discord
19:33:40 [on a call] Discord has the microphone
19:33:52 Roman: Hast du den Link geschickt?
19:33:55 Speaker 1: Ja, schau in den Chat.
19:34:01 Speaker 2: I can't hear you guys.
```

What came in on the microphone carries your name, as the account's settings give it. The voices on the desktop's channel are numbered in the order they first speak; a line the service could not give to anyone reads `Others`. Each channel is transcribed on its own, so two people talking at once are two lines.

A recording runs until you stop it, and has no silence stop, since a call has silences in it. One in which no words were heard is saved as its audio alone: there is nothing to put in a transcript, so none is written.

### Recordings folder

Where a recording's audio and transcript are saved, `~/Documents/Murmur` by default. **Choose** picks a folder, and **Reset** goes back to the default. The folder is created on the first recording if it does not exist yet.

The folder is read as a recording starts, so a recording stays where it started even when the folder changes while it runs, and its notifications name the folder it is in. From the command line, a path starting with `~/` is in your home folder.

### Piece length

How many minutes of a recording the service transcribes at a time, ten by default. A longer recording is cut where it is quietest in the minute before each mark, so no word is split, and each piece also hears fifteen seconds of its neighbours. 0 transcribes the whole recording at once.

Fewer cuts give a voice on the call fewer chances to come back under a new number. A longer piece is more for the service to take at once, though: Mistral turns away one whose audio and names and terms together outrun its model's context, OpenRouter's providers give a request about a minute, and This computer tells apart four voices in each piece. A recording the service refused keeps its audio, and **Retry** cuts it again at the length set by then. A shorter piece costs more with a cloud service, since its fifteen seconds either side are billed too: 5% more at ten minutes, half as much again at one.

The length is read as a transcription starts, so changing it leaves one already under way alone. It holds for **Transcribe a file** too.

### Note what is on screen and playing

On by default. A recording's transcript then notes what went on around it, each at the moment it changed, as a line in brackets among what was said:

| Line | When |
| --- | --- |
| `[open] Brave: "Jira - Brave"` | Each window open as the recording starts, with its application and title. A browser's title is the tab in front in that window |
| `[focused] Brave: "Jira - Brave"` | The window in front, or its title, changes |
| `[playing] Brave: "Song" by Artist` | An application starts playing, with the title and artist of what it plays where it says, as browsers and music players do |
| `[stopped] Brave` | It stops |
| `[on a call] Teams has the microphone` | Another application opens the microphone, which is what a call does; `[off the call]` when it lets go |
| `[camera on]`, `[camera off]` | Any application opens or closes a camera |
| `[sharing screen]`, `[stopped sharing]` | The screen is shared, as the top bar's sharing indicator shows |
| `[away] no input for 5 minutes`, `[back]` | Neither keyboard nor mouse is touched for five minutes, stamped from the last touch, and the first touch after |
| `[network] Office, VPN Work` | The network changes: the connection in use, and any VPN |

Each is written once it has held for five seconds, so passing through a window on the way to another, or a notification sound, leaves nothing behind. With the switch off, none of these is written, and the header has no `network`.

Either way, the header holds the computer's name, the day and the times the recording started and ended, the microphone and the output it went through, and the service and model that transcribed it; and the timeline holds `[locked]` and `[unlocked]` when the screen locks, `[microphone]` or `[output]` when the default device changes, and `[interrupted] nothing recorded for 2 seconds` where GNOME switched Murmur off and on again and the recording carried on. None of it is sent to the service: it is added on your machine, from a note Murmur keeps while recording in `~/.local/state/murmur@roman-16.github.io/context/`, which is why transcribing a recording again keeps it. A note whose recording's audio has been deleted is removed the next time Murmur starts.

A file from anywhere else, or a recording from another computer, has no note, and its transcript has no header.

### Transcribe a file

Transcribes an audio file you choose - a recording again, or audio from anywhere else, in any format GStreamer plays - with the service picked beside it. The list holds the services that are ready - a cloud service with a key, This computer with its engine and a model - and follows **Service** until you pick another. The file chooser opens in the recordings folder.

The transcript is saved beside the audio under the same name, `interview.md` for `interview.m4a`. When one is already there, Murmur asks before replacing it, and replaces it only once the new transcript is done; a transcription that hears no words leaves it as it is. The file is transcribed the way a recording is, with its pill, its notification and **Retry**, and billed the same.

A recording of Murmur's is told apart by channel as above. Any other file, one without Murmur's two channels, is heard as one track: every voice is numbered, and the time counts from `00:00:00` unless the file is named the way Murmur names a recording, in which case it is the time of day.

The same service gives the same words for the same audio, so a recording transcribed again by the service that got it wrong mostly comes back wrong the same way. Pick another service, or another OpenRouter model.

A script can ask for the same thing over D-Bus, with the file's full path and `local`, `mistral`, `openrouter` or `xai`:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/Murmur --method org.gnome.Shell.Extensions.Murmur.Transcribe ~/Downloads/interview.m4a xai
```

It answers `()` once the transcription has started, or with the reason it refused: a file that is not there or is not audio, a service that is not set up, the recording still running, or a file already being transcribed.

## History

### Remember what I dictate

On by default. The text of every finished dictation is appended to `~/.local/state/murmur@roman-16.github.io/history.jsonl`, in plain text, and listed on the **History** page, newest first.

- **Click a dictation to copy it** to the clipboard.
- **Search** them in the field above the list, which goes through every dictation kept. The magnifier in the window's header searches the settings.
- **The bin** beside a dictation deletes it, and **Undo** on the toast puts it back.
- **Clear history…** deletes the file, after asking.
- The list shows 128 at a time, and **Show older dictations** at its end the next 128.
- A field the application reports as a password is never kept, nor is a dictation you cancelled with `Esc`. XWayland applications report nothing, so a password dictated into one would be kept.

Turn the switch off and nothing further is written. What is already there stays until you clear it, and uninstalling does not remove it:

```bash
rm -r ~/.local/state/murmur@roman-16.github.io
```

### Dictations kept

How many of the newest dictations are kept: 128 by default, and any number from 1 up. Lowering it hides the older ones at once and deletes them from the file when the next dictation is saved, so raising it again before then brings them back.

## From the command line

Every setting is a GSettings key under `org.gnome.shell.extensions.murmur`, which makes them scriptable and easy to keep in dotfiles:

```bash
gsettings set org.gnome.shell.extensions.murmur transcription-provider xai
gsettings set org.gnome.shell.extensions.murmur xai-api-key "$(cat ~/.secrets/xai)"
gsettings set org.gnome.shell.extensions.murmur mistral-api-key "$(cat ~/.secrets/mistral)"
gsettings set org.gnome.shell.extensions.murmur openrouter-api-key "$(cat ~/.secrets/openrouter)"
gsettings set org.gnome.shell.extensions.murmur openrouter-model meta/muse-voice-transcribe-1.0
gsettings set org.gnome.shell.extensions.murmur local-model ~/Models/parakeet-tdt-0.6b-v3-Q8_0.gguf
gsettings set org.gnome.shell.extensions.murmur names-and-terms "['Lukas', 'Valheim', 'Ashlands']"
gsettings set org.gnome.shell.extensions.murmur remember-dictations false
gsettings set org.gnome.shell.extensions.murmur toggle-dictation "['<Super>space']"
gsettings set org.gnome.shell.extensions.murmur toggle-recording "['<Super><Alt>space']"
gsettings set org.gnome.shell.extensions.murmur recording-folder '~/Notes/Calls'
gsettings set org.gnome.shell.extensions.murmur recording-piece-minutes 30
gsettings set org.gnome.shell.extensions.murmur record-context false
gsettings set org.gnome.shell.extensions.murmur show-panel-on-start false
gsettings set org.gnome.shell.extensions.murmur max-dictation-seconds 120
gsettings set org.gnome.shell.extensions.murmur silence-timeout-seconds 3
gsettings set org.gnome.shell.extensions.murmur typing-speed 500
```

| Key | Type | Default | Range |
| --- | --- | --- | --- |
| `local-model` | string | empty | The full path of a speech model the engine runs |
| `local-model-settings` | dictionary | empty | For each model file's full path, the settings changed from the engine's own: `language`, `live`, `settle`, `pnc`, `itn`, or the family's own as `ParakeetBufferedStreamOptions.right_ms` |
| `max-dictation-seconds` | integer | 600 | 15 to 86400, and to 600 in the preferences while Mistral, OpenRouter or This computer is selected |
| `mistral-api-key` | string | empty | |
| `names-and-terms` | string list | empty | |
| `openrouter-api-key` | string | empty | |
| `openrouter-model` | string | `meta/muse-voice-transcribe-1.0` | Any model slug OpenRouter transcribes with |
| `recording-folder` | string | `~/Documents/Murmur` | Any folder; a leading `~` is your home folder |
| `recording-piece-minutes` | integer | 10 | 0 to 1440; 0 transcribes a recording at once |
| `remember-dictations` | boolean | `true` | |
| `show-panel-on-start` | boolean | `true` | |
| `silence-timeout-seconds` | integer | 0 | 0 to 30 |
| `toggle-dictation` | string list | `['<Super>space']` | |
| `toggle-recording` | string list | `['<Super><Alt>space']` | |
| `transcription-provider` | `local`, `mistral`, `openrouter` or `xai` | `mistral` | |
| `typing-speed` | integer | 2000 | 10 to 5000 |
| `xai-api-key` | string | empty | |

A source install has to point `gsettings` at the schema it built, since it is not in the system directory:

```bash
GSETTINGS_SCHEMA_DIR=$PWD/dist/schemas gsettings get org.gnome.shell.extensions.murmur typing-speed
```
