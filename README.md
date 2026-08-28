<div align="center">

<img src="assets/icon.svg" width="96" height="96" alt="" />

# Murmur

**Speak into any text field in GNOME.**

[![Release](https://img.shields.io/github/v/release/roman-16/murmur?sort=semver&style=flat-square&color=6E7BF2)](https://github.com/roman-16/murmur/releases/latest) [![GNOME](https://img.shields.io/badge/GNOME-47%20%7C%2048%20%7C%2049%20%7C%2050-6E7BF2?style=flat-square)](docs/installation.md) [![Session](https://img.shields.io/badge/session-Wayland-6E7BF2?style=flat-square)](docs/installation.md) [![License](https://img.shields.io/github/license/roman-16/murmur?style=flat-square&color=6E7BF2)](LICENSE)

<img src="assets/demo.webp" alt="Murmur transcribing a spoken sentence live and inserting it into a text editor" width="760" />

</div>
<br />

Press `Super+Space`, say what you mean, and the words appear where your cursor already is: in a browser, an editor, a chat box or a terminal. No window to switch to, no daemon in the background, and nothing to paste afterwards.

- **You keep working while it listens.** A small panel appears at the bottom of the screen you are working on; it takes nothing over. Look anywhere else - another window, the overview, the window you were already in - and it collapses by itself, leaving a recording indicator with the countdown in the top bar. It is on screen exactly while it has your keyboard, so it is never in the way and never swallowing keys.
- **It lands where you are looking.** Where there is a field, the transcription is typed into it, in any application, terminals included, with nothing pasted and your clipboard untouched. Which field is decided when you stop, so you can go and find it while you talk.
- **You watch it happen.** Audio streams to the service you picked over a WebSocket while you speak, and the text appears in the panel as it arrives, with a countdown and an optional hands-free stop after silence. Transcription runs on [Gemini 3.5 Transcribe Live](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe) or [Mistral Voxtral](https://mistral.ai), whichever you choose in the preferences.
- **Nothing is ever lost.** If no text field is focused when you stop, Murmur copies the transcription to the clipboard instead of firing a sentence worth of keystrokes at whatever happens to be in front.

## Install

```bash
curl -fLo /tmp/murmur.zip https://github.com/roman-16/murmur/releases/latest/download/murmur@roman-16.github.io.shell-extension.zip && gnome-extensions install -f /tmp/murmur.zip && rm /tmp/murmur.zip
```

Then log out and back in, which Wayland requires for a new extension, and enable it:

```bash
gnome-extensions enable murmur@roman-16.github.io
```

You need **GNOME Shell 47 to 50 on Wayland**, **`pw-record`** from PipeWire, and an **API key** for one of the two transcription services. Installing with Nix, from source, from extensions.gnome.org once the listing is approved, updating and uninstalling: → [Installation](docs/installation.md)

## Get started

Open the preferences, choose the service that transcribes for you, and paste in its key:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

| Service | Key from | What it costs |
| --- | --- | --- |
| **Gemini 3.5 Transcribe Live** (default) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Nothing on Google's free tier, which uses what you dictate to improve their products; about $0.009 a minute once you pay. A recording runs ten minutes at most |
| **Mistral Voxtral Realtime** | [console.mistral.ai](https://console.mistral.ai) | About $0.006 a minute of audio, from the first minute |

That is the whole setup. Put the cursor where the words belong, press `Super+Space`, and speak.

| Key | What it does |
| --- | --- |
| `Super+Space` | Start recording, and stop it the same way `Enter` does. Works from anywhere, always |
| `Enter` | Stop and deliver the transcription |
| `Ctrl+Enter` | Stop and copy to the clipboard |
| `Esc` | Cancel, insert nothing, copy nothing |

`Enter`, `Ctrl+Enter` and `Esc` reach the panel while it is on screen, which is exactly while it holds the keyboard. Look anywhere else and both go at once: the keyboard is yours again and the panel collapses to the top bar. `Super+Space` is a system shortcut and works either way.

→ [Getting started](docs/getting-started.md)

## Where your text goes

Murmur asks where the words go **at the moment you stop**, and the panel names the destination the whole time you are speaking, so it is never a surprise at the end.

| What Murmur sees when you stop | What it does |
| --- | --- |
| An application with a focused field | Types the transcription into it with [dotool](docs/text-insertion.md#dotool), or the shell's virtual keyboard when dotool is unavailable |
| Nothing that can take text | Copies it to the clipboard and says so, rather than turning your sentence into keyboard shortcuts |

Because the question is asked at the end, you can start talking anywhere and click into the right field while you speak. `Ctrl+Enter` copies instead, whatever the panel says, for when the words belong somewhere other than the field in front of you.

Want to know whether an application is recognised? Turn on GNOME's on-screen keyboard and click into the field. If it pops up, Murmur sees that field too, because both read the same signal. → [Where the text goes](docs/text-insertion.md)

## What leaves your machine

Your voice, to the service you picked - `generativelanguage.googleapis.com` by default, or `api.mistral.ai` - while you are recording. That is the only connection Murmur makes: no telemetry, no analytics, no update pings.

The transcription is never written to disk and the audio never touches it either. Your API key is stored in dconf like every other GNOME setting, which means unencrypted, because extensions have no keyring access. If a dictation must not reach a third party, Murmur is the wrong tool. → [Privacy](docs/privacy.md)

## Documentation

| Page | What's in it |
| --- | --- |
| [Installation](docs/installation.md) | Every install route, requirements, updating, uninstalling |
| [Getting started](docs/getting-started.md) | Your API key, your first dictation, the four keys |
| [Configuration](docs/configuration.md) | Every setting, what it changes, and its `gsettings` key |
| [Where the text goes](docs/text-insertion.md) | The insertion ladder, which apps are recognised, dotool setup |
| [Troubleshooting](docs/troubleshooting.md) | Symptom, cause, fix |
| [How it works](docs/how-it-works.md) | Shortcut to text, step by step, and what runs where |
| [Privacy](docs/privacy.md) | What leaves your machine, what is stored, what it costs |
| [Limitations](docs/limitations.md) | What Murmur will not do, and why |

## Good to know

- **A terminal is one big text field.** It tells the compositor it accepts text whenever it is focused and nothing finer, so Murmur will happily deliver a sentence to vim in normal mode.
- **Dictation is billed to your key.** Murmur sends only what it records, and the ten-minute cap keeps a forgotten recording from running away.
- **Gemini's free tier is free, and reads what you say.** Google's pricing page states that free-tier usage is used to improve their products, and the paid tier that it is not. Mistral bills from the first minute either way.
- **A dictation always arrives as one line.** Line breaks are flattened to spaces before anything is typed, so a transcription can never press `Enter` in a chat box, a prompt or a shell. A tidied list keeps its bullets, inline.
- **The panel is not a window.** It cannot be alt-tabbed or pushed behind an application, because a GNOME Shell extension draws inside the compositor rather than opening a window. Clicking anything else collapses it to the top bar instead, which a window behind a maximised application could not do.
- **Wayland only.** XWayland applications inside a Wayland session are fine; an X11 session is not.
- **dotool is recommended.** Without it the fallback keyboard can only produce characters from your current layout, so emoji and other scripts are dropped.
- **Passwords are typed, never copied.** A password field is still a text field, so nothing lands on the clipboard.

## Contributing

Issues, ideas and pull requests are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup and the everyday commands, [`CHANGELOG.md`](CHANGELOG.md) records what each version changed, and [`SECURITY.md`](SECURITY.md) has the private channel for security reports.

## License

[MIT](LICENSE)
