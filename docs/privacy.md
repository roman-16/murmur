# Privacy

Murmur transcribes in the cloud. That is a real trade-off, and this page states exactly what it means rather than burying it.

## What leaves your machine

**Your voice, while you dictate, and everything your computer plays while you record.** Audio goes over an encrypted connection to the service you chose, along with your API key in a request header. That is the only network connection Murmur makes.

| Service | Host | Key travels as | A dictation is sent | A recording is sent |
| --- | --- | --- | --- | --- |
| Grok Voice Transcribe 2.0 | `api.x.ai` | `Authorization: Bearer` | Streamed over a WebSocket while you speak | Whole, in one request, when you stop |
| Mistral Voxtral (default) | `api.mistral.ai` | `Authorization: Bearer` | Streamed over a WebSocket while you speak | Whole, in one request, when you stop |
| OpenRouter | `openrouter.ai` | `Authorization: Bearer` | Whole, in one request, when you stop | Whole, in one request, when you stop |

That is also everything. No usage statistics, no crash reports, no analytics, no update checks, and nothing that identifies Murmur as the client. Murmur contacts one host, and only over a dictation or a recording you started.

The preferences window makes one further request, and only while OpenRouter is selected: it asks `openrouter.ai` which models transcribe, so the **Model** list is current. It carries no key and nothing about you.

What happens to that audio afterwards is the service's business, governed by their terms and privacy policy for the account the key belongs to. Three things are worth reading before you pick:

- **xAI says it neither keeps nor trains on your voice**, by its own documentation: audio sent to its voice APIs is processed in real time and never stored or used for training. Whether that covers a recording uploaded as a file, rather than streamed, is for xAI's terms to say. It bills from the first minute, against credit the account holds.
- **Mistral bills from the first minute**, and its terms for your account govern the audio either way.
- **OpenRouter hands your audio to whichever provider serves the model you picked**, so two sets of terms apply: OpenRouter's and that provider's. Which provider serves a model is on its page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription).

A recording holds other people: everyone in the call, and whatever else was playing. Their voices go to the service as yours do. Tell them you are recording, and what your jurisdiction and your employer require of a recording is yours to know before you make one.

If what you say must not reach a third party, Murmur is the wrong tool, and a local model is the right one.

## What is stored on your machine

| What | Where | Notes |
| --- | --- | --- |
| Your API keys | dconf, under `/org/gnome/shell/extensions/murmur/` | **Unencrypted**, like every GSettings value. Any process running as you can read it. Each service keeps its own, and the one you are not using stays there until you clear it |
| Your other settings | The same place | Shortcuts, delays, limits |
| A dictation's transcription | `~/.local/state/murmur@roman-16.github.io/history.jsonl` | **Unencrypted**, one line per dictation, oldest first, the newest 500 kept |
| A dictation's audio | Nowhere | It goes from the microphone to the network and is never written to disk. With OpenRouter it is held in memory until you stop, and released once it has been sent |
| A recording's audio | `~/Documents/Murmur/`, as `2026-03-26T22-02-34.opus` | Written as it is recorded, readable by you alone, and kept until you delete it |
| A recording's transcript | Beside its audio, as `2026-03-26T22-02-34.md` | Exactly what the service returned, readable by you alone, kept until you delete it |
| Which recordings still owe a transcript | `~/.local/state/murmur@roman-16.github.io/untranscribed` | The paths of recordings whose transcription has not come back yet, so they can be offered again; a path leaves once its transcript is written |

The folder is the Documents folder your desktop names, `~/Documents` unless it is called something else in your language, and Murmur creates `Murmur` inside it readable by you alone. While a recording is being sent, the upload is assembled in a temporary file of the same privacy and deleted afterwards.

## Your dictation history

**Remember what I dictate** is on, so the text of every finished dictation is written to that file and listed on the **History** page of the preferences, where a click copies one and **Clear history** deletes the file. Turn the switch off and nothing further is written; what was written stays until you clear it.

Three things are worth knowing about it:

- **It is plain text with no encryption**, readable by anything running as you, exactly like your API key. That is the same platform limit: extensions have no keyring.
- **A password field is never kept**, when the application says it is one. Wayland applications announce it and are honoured; XWayland applications announce nothing at all, so a password dictated into one would be kept.
- **A cancelled dictation is never kept.** `Esc` stores nothing, and neither does a dictation that transcribed nothing.

A recording is not part of the history. Its files are its record, and deleting them is the whole of forgetting it.

An API key in dconf is the same protection GNOME gives every other setting, which is to say it protects you from other users on the machine and not from software running as you. GNOME extensions have no access to the system keyring, so this is the honest limit rather than a choice.

## The clipboard

When there is no text field to insert into, the transcription is placed on the clipboard, which replaces whatever was there. The panel names that destination while you speak and confirms it before closing. If you use a clipboard manager, the transcription lands in its history like anything else you copy. A recording's transcript reaches the clipboard only when you press **Copy** on its notification.

Passwords dictated into a password field are typed, never copied. See [Where the text goes](text-insertion.md).

## The microphone

The microphone is opened when a dictation or a recording starts and released the moment it ends, including when you cancel or discard. Nothing listens in the background, so there is no wake word, no voice activity detection running all day, and an indicator in the top bar is on exactly as long as Murmur is listening.

A recording carries on while the screen is locked, and its pill stays in the top bar of the lock screen, so anyone looking at the machine can see that it is recording.

## What it costs

Transcription is billed to the account the key belongs to, by the audio you send. Murmur sends only what it hears between pressing a shortcut and stopping. **Maximum dictation time**, ten minutes by default, caps what a forgotten dictation can spend, and **Stop after silence** ends a dictation you walked away from. A recording runs until you stop it or the service's limit ends it, and the pill in the top bar is the reminder that it is running.

| Service | An hour of dictation | An hour of recording |
| --- | --- | --- |
| Grok Voice Transcribe 2.0 | About $0.20 | About $0.10 |
| Mistral Voxtral | About $0.36 | About $0.18 |
| OpenRouter | The selected model's own price, from about $0.18. Each model's page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription) states it, and every request answers with what it cost | The same |
