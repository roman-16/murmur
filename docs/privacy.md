# Privacy

Murmur transcribes in the cloud. That is a real trade-off, and this page states exactly what it means rather than burying it.

## What leaves your machine

**Your voice, while you are recording.** Raw audio goes over an encrypted connection to the service you chose, along with your API key in a request header. That is the only network connection Murmur makes.

| Service | Host | Key travels as | Sent |
| --- | --- | --- | --- |
| Grok Voice Transcribe 2.0 (default) | `api.x.ai` | `Authorization: Bearer` | Streamed over a WebSocket while you speak |
| Gemini 3.5 Transcribe Live | `generativelanguage.googleapis.com` | `x-goog-api-key` | Streamed over a WebSocket while you speak |
| Mistral Voxtral Realtime | `api.mistral.ai` | `Authorization: Bearer` | Streamed over a WebSocket while you speak |
| OpenRouter | `openrouter.ai` | `Authorization: Bearer` | The whole recording in one request when you stop |

That is also everything. No usage statistics, no crash reports, no analytics, no update checks, and nothing that identifies Murmur as the client. Murmur contacts one host, and only over a dictation you started.

The preferences window makes one further request, and only while OpenRouter is selected: it asks `openrouter.ai` which models transcribe, so the **Model** list is current. It carries no key and nothing about you.

What happens to that audio afterwards is the service's business, governed by their terms and privacy policy for the account the key belongs to. Four things are worth reading before you pick:

- **xAI neither keeps nor trains on your voice**, by its own documentation: audio sent to its voice APIs is processed in real time and never stored or used for training. It bills from the first minute, against credit the account holds.
- **Google's free tier trains on what you dictate.** Its pricing page marks *used to improve our products* as yes for the free tier and no for the paid one. A free key is therefore the cheapest option and the least private.
- **Mistral bills from the first minute**, and its terms for your account govern the audio either way.
- **OpenRouter hands your audio to whichever provider serves the model you picked**, so two sets of terms apply: OpenRouter's and that provider's. Which provider serves a model is on its page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription).

If your dictation must not reach a third party, Murmur is the wrong tool, and a local model is the right one.

## What is stored on your machine

| What | Where | Notes |
| --- | --- | --- |
| Your API keys | dconf, under `/org/gnome/shell/extensions/murmur/` | **Unencrypted**, like every GSettings value. Any process running as you can read it. Each service keeps its own, and the one you are not using stays there until you clear it |
| Your other settings | The same place | Shortcut, delays, limits |
| The transcription | `~/.local/state/murmur@roman-16.github.io/history.jsonl` | **Unencrypted**, one line per dictation, oldest first, the newest 500 kept |
| The audio | Nowhere | It goes from the microphone to the network and is never written to disk. With OpenRouter it is held in memory until you stop, and released once it has been sent |

## Your dictation history

**Remember what I dictate** is on, so the text of every finished dictation is written to that file and listed on the **History** page of the preferences, where a click copies one and **Clear history** deletes the file. Turn the switch off and nothing further is written; what was written stays until you clear it.

Three things are worth knowing about it:

- **It is plain text with no encryption**, readable by anything running as you, exactly like your API key. That is the same platform limit: extensions have no keyring.
- **A password field is never kept**, when the application says it is one. Wayland applications announce it and are honoured; XWayland applications announce nothing at all, so a password dictated into one would be kept.
- **A cancelled dictation is never kept.** `Esc` stores nothing, and neither does a recording that transcribed nothing.

An API key in dconf is the same protection GNOME gives every other setting, which is to say it protects you from other users on the machine and not from software running as you. GNOME extensions have no access to the system keyring, so this is the honest limit rather than a choice.

## The clipboard

When there is no text field to insert into, the transcription is placed on the clipboard, which replaces whatever was there. The panel names that destination while you speak and confirms it before closing. If you use a clipboard manager, the transcription lands in its history like anything else you copy.

Passwords dictated into a password field are typed, never copied. See [Where the text goes](text-insertion.md).

## The microphone

The microphone is opened when a recording starts and released the moment it ends, including when you cancel. Nothing listens in the background, so there is no wake word, no voice activity detection running all day, and the recording indicator in the top bar is on exactly as long as Murmur is recording.

## What it costs

Transcription is billed to the account the key belongs to, by the audio you send. Murmur sends only what it records, which is your speech between pressing the shortcut and stopping. **Maximum recording time**, ten minutes by default, caps what a forgotten recording can spend, and **Stop after silence** ends a recording you walked away from.

| Service | Per minute of audio |
| --- | --- |
| Grok Voice Transcribe 2.0 | About $0.0033, which is $0.20 an hour |
| Gemini 3.5 Transcribe Live | Nothing on the free tier; about $0.009 on the paid one |
| Mistral Voxtral Realtime | About $0.006 |
| OpenRouter | The selected model's own price, from about $0.003. Each model's page at [openrouter.ai](https://openrouter.ai/models?output_modalities=transcription) states it, and every request answers with what it cost |
