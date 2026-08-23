# Getting started

## Add your API key

Murmur transcribes with [Mistral Voxtral](https://mistral.ai), so it needs a key of your own. Create one at [console.mistral.ai](https://console.mistral.ai), then open the preferences:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

Paste the key into **Mistral API key**. That is the whole setup. Nothing else has to be configured before the first dictation.

## Dictate

1. Put the cursor where the words should land, in any application.
2. Press **Super+Space**. A centered overlay opens and recording starts.
3. Speak. The transcription appears in the overlay while you are still talking.
4. Press **Enter** (or Super+Space again). The overlay closes and the text is inserted.

## The four keys

| Key | What it does |
| --- | --- |
| **Super+Space** | Starts the recording, and ends it the same way Enter does |
| **Enter** | Stops and delivers the transcription to the destination the overlay names |
| **Ctrl+Enter** | Stops and copies to the clipboard, whatever the overlay says it would do |
| **Esc** | Cancels. Nothing is inserted, nothing is copied |

`Page Up`, `Page Down`, `Home`, `End` and the arrow keys scroll a long transcription while it is still being recorded.

## Where the words go

Murmur decides before it starts recording, and the overlay states it under the header for the whole recording.

- **A text field is focused.** It reads *Types into the focused text field*, and `Enter` puts the transcription there.
- **Nothing can take text.** It reads *No text field focused, copies to the clipboard*, `Enter` copies, and a small message confirms it once the overlay is gone.

Deciding up front is deliberate: you know where the words will land before you say them, and `Ctrl+Enter` sends them to the clipboard instead whenever you would rather keep them than place them. [Where the text goes](text-insertion.md) explains how the decision is made and which applications are recognised.

## Change the shortcut

In the preferences, click the shortcut next to **Recording shortcut**, press the combination you want, and it takes effect for the next dictation. `Backspace` clears it, which disables the shortcut entirely; `Esc` keeps the old one.

## Hands-free stops

Two settings end a recording without you pressing anything:

- **Stop after silence** ends it after a number of seconds without speech. Off by default.
- **Maximum recording time** ends it after ten minutes, so a forgotten recording cannot run forever.

Both deliver the transcription exactly as `Enter` would. See [Configuration](configuration.md).
