# Getting started

## Pick a service and add its key

Murmur transcribes in the cloud, so it needs a key of your own. Two services are on offer, and you pick one in the preferences:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

| **Service** | Key from | Good to know |
| --- | --- | --- |
| **Gemini 3.5 Transcribe Live** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | The default. Free of charge on Google's free tier, which uses what you dictate to improve their products. Tidies up filler words for you. A recording runs ten minutes at most |
| **Mistral Voxtral Realtime** | [console.mistral.ai](https://console.mistral.ai) | About $0.006 a minute, billed from the first one, and how far text trails your voice is yours to set |

Choose it under **Service**, paste your key into **API key** below it, and that is the whole setup. Each service keeps its own key, so switching back and forth costs nothing.

Nothing else has to be configured before the first dictation.

## Dictate

1. Put the cursor where the words should land, in any application.
2. Press **Super+Space**. A panel appears at the bottom of the screen you are working on and recording starts.
3. Speak. The transcription appears in the panel while you are still talking.
4. Press **Enter** (or Super+Space again). The panel closes and the text is inserted.

## The four keys

| Key | What it does |
| --- | --- |
| **Super+Space** | Starts the recording, and ends it the same way Enter does. Works whatever is focused |
| **Enter** | Stops and delivers the transcription to the destination the panel names |
| **Ctrl+Enter** | Stops and copies to the clipboard, whatever the panel says it would do |
| **Esc** | Cancels. Nothing is inserted, nothing is copied |

`Page Up`, `Page Down`, `Home`, `End` and the arrow keys scroll a long transcription while it is still being recorded.

All of those except **Super+Space** reach the panel while it is on screen, which is exactly while it holds the keyboard. See [Keeping your hands free](#keeping-your-hands-free).

## Keeping your hands free

The panel takes nothing over. While it is recording you can click into another window, scroll, and carry on working; the microphone keeps running.

There is one rule, and everything else follows from it: **the panel is on screen exactly while it has your keyboard.**

- **It opens with the keyboard**, so `Enter`, `Ctrl+Enter` and `Esc` work straight away.
- **It opens where you are.** With more than one monitor, the panel appears on the one whose window has focus, and on the pointer's when nothing is focused. Move screens and bring it back, and it comes back on the new one.
- **Look anywhere else and it collapses.** Click another window, click the window you were already in, press `Super` for the overview, alt-tab: the keyboard goes back where you sent it and the panel gets out of the way rather than sitting there swallowing keys.
- **The recording carries on.** A red indicator with the countdown stays in the top bar; click it to bring the panel back, keyboard and all.
- **Super+Space always stops**, collapsed or not.

So the panel is never in a state where it is visible but ignoring you, and your keystrokes only ever go to one place.

If you would rather nothing appeared over your work at all, turn off **Show the panel when recording starts** in the preferences. A recording then begins collapsed: just the indicator in the top bar, and the panel when you ask for it.

## Where the words go

Murmur asks the question when you stop, and the panel names the answer under the transcription the whole time you are speaking.

- **A text field is focused.** It reads *Types into Text Editor*, naming the application, and `Enter` puts the transcription there.
- **Nothing can take text.** It reads *No text field focused · copies to the clipboard*, `Enter` copies, and the panel confirms it before closing.

Because the answer is read at the end rather than the start, you can press the shortcut anywhere, start talking, and click into the field you actually want while you speak. `Ctrl+Enter` sends the words to the clipboard instead whenever you would rather keep them than place them. [Where the text goes](text-insertion.md) explains how the decision is made and which applications are recognised.

## Change the shortcut

In the preferences, click the shortcut next to **Recording shortcut**, press the combination you want, and it takes effect for the next dictation. `Backspace` clears it, which disables the shortcut entirely; `Esc` keeps the old one.

## Hands-free stops

Two settings end a recording without you pressing anything:

- **Stop after silence** ends it after a number of seconds without speech. Off by default.
- **Maximum recording time** ends it after ten minutes, so a forgotten recording cannot run forever. The countdown is in the panel and in the top-bar indicator.

Both deliver the transcription exactly as `Enter` would. See [Configuration](configuration.md).

## Let it tidy up what you say

With Gemini, **Tidy up what I say** is on, so the model cleans up as it transcribes. Say this:

> Um, so I was thinking uh we should meet on Tuesday, no wait, on Wednesday and um bring three things, the report, the laptop and uh the keys.

and what lands in the field is this:

> I was thinking we should meet on Wednesday and bring three things:
> - The report
> - The laptop
> - The keys

Fillers gone, the correction resolved, the list formatted. Turn it off and you get what you said, word for word.

**One thing to know before dictating into a chat box:** a formatted list means line breaks, and Murmur types a line break as `Enter`, which a chat box reads as *send*. Turn **Tidy up what I say** off for that, or press `Ctrl+Enter` to take the text to the clipboard and paste it yourself.

It applies to the finished transcription, so the text in the panel may rearrange itself when the recording ends.
