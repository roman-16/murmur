# Privacy

Murmur transcribes in the cloud. That is a real trade-off, and this page states exactly what it means rather than burying it.

## What leaves your machine

**Your voice, while you are recording.** From the moment the panel opens until the recording ends, raw audio is streamed over an encrypted WebSocket to the service you chose, along with your API key in a request header. That is the only network connection Murmur makes.

| Service | Host | Key travels as |
| --- | --- | --- |
| Gemini 3.5 Transcribe Live (default) | `generativelanguage.googleapis.com` | `x-goog-api-key` |
| Mistral Voxtral Realtime | `api.mistral.ai` | `Authorization: Bearer` |

That is also everything. No usage statistics, no crash reports, no analytics, no update checks. Murmur contacts one host, and only while you are speaking to it.

What happens to that audio afterwards is the service's business, governed by their terms and privacy policy for the account the key belongs to. Two things are worth reading before you pick:

- **Google's free tier trains on what you dictate.** Its pricing page marks *used to improve our products* as yes for the free tier and no for the paid one. A free key is therefore the cheapest option and the least private - and since Gemini is the default service, it is the trade Murmur makes unless you change it.
- **Mistral bills from the first minute**, and its terms for your account govern the audio either way.

If your dictation must not reach a third party, Murmur is the wrong tool, and a local model is the right one.

## What is stored on your machine

| What | Where | Notes |
| --- | --- | --- |
| Your API keys | dconf, under `/org/gnome/shell/extensions/murmur/` | **Unencrypted**, like every GSettings value. Any process running as you can read it. Each service keeps its own, and the one you are not using stays there until you clear it |
| Your other settings | The same place | Shortcut, delays, limits |
| The transcription | Nowhere | It exists in memory, is delivered, and is gone |
| The audio | Nowhere | It is streamed from the microphone to the socket and never written to disk |

There is no history, no cache and no log of what you dictated. Closing the panel is the end of it.

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
| Gemini 3.5 Transcribe Live | Nothing on the free tier; about $0.009 on the paid one |
| Mistral Voxtral Realtime | About $0.006 |
