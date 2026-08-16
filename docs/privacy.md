# Privacy

Murmur transcribes in the cloud. That is a real trade-off, and this page states exactly what it means rather than burying it.

## What leaves your machine

**Your voice, while you are recording.** From the moment the overlay opens until the recording ends, raw audio is streamed to `api.mistral.ai` over an encrypted WebSocket, along with your API key in the `Authorization` header. That is the only network connection Murmur makes.

That is also everything. No usage statistics, no crash reports, no analytics, no update checks. Murmur contacts one host, and only while you are speaking to it.

What happens to that audio afterwards is Mistral's business, governed by their terms and privacy policy for the account the key belongs to. If your dictation must not reach a third party, Murmur is the wrong tool, and a local model is the right one.

## What is stored on your machine

| What | Where | Notes |
| --- | --- | --- |
| Your API key | dconf, under `/org/gnome/shell/extensions/murmur/` | **Unencrypted**, like every GSettings value. Any process running as you can read it |
| Your other settings | The same place | Shortcut, delays, limits |
| The transcription | Nowhere | It exists in memory, is delivered, and is gone |
| The audio | Nowhere | It is streamed from the microphone to the socket and never written to disk |

There is no history, no cache and no log of what you dictated. Closing the overlay is the end of it.

An API key in dconf is the same protection GNOME gives every other setting, which is to say it protects you from other users on the machine and not from software running as you. GNOME extensions have no access to the system keyring, so this is the honest limit rather than a choice.

## The clipboard

When there is no text field to insert into, the transcription is placed on the clipboard, which replaces whatever was there. This only happens on the path the overlay announced, and a message confirms it. If you use a clipboard manager, the transcription lands in its history like anything else you copy.

Passwords dictated into a password field are typed, never copied. See [Where the text goes](text-insertion.md).

## The microphone

The microphone is opened when a recording starts and released the moment it ends, including when you cancel. Nothing listens in the background, so there is no wake word, no voice activity detection running all day, and the recording indicator in the top bar is on exactly as long as Murmur is recording.

## What it costs

Transcription is billed to your Mistral account by the audio you send. Murmur sends only what it records, which is your speech between pressing the shortcut and stopping. **Maximum recording time**, two minutes by default, caps what a forgotten recording can spend, and **Stop after silence** ends a recording you walked away from.
