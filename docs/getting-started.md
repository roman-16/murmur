# Getting started

## Pick a service and add its key

Murmur transcribes in the cloud, so it needs a key of your own. Three services are on offer, and you pick one in the preferences:

```bash
gnome-extensions prefs murmur@roman-16.github.io
```

| **Service** | Key from | Good to know |
| --- | --- | --- |
| **Grok** | [console.x.ai](https://console.x.ai) | The most accurate while you speak. About $0.20 an hour dictating and $0.10 an hour recording, and the key works once the account holds credit. A dictation runs as long as you set, a recording as long as you like |
| **Mistral Voxtral** | [console.mistral.ai](https://console.mistral.ai) | The default. About $0.36 an hour dictating and $0.18 an hour recording, billed from the first minute, and how far text trails your voice is yours to set. A recording runs three hours at most |
| **OpenRouter** | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | One key for every transcription model it serves - Whisper, Nova, Voxtral, Parakeet - which you pick under **Model**. It cannot transcribe while you speak, so the words arrive when you stop. A dictation runs ten minutes at most, a recording two hours |

Choose it under **Service**, paste your key into **API key** below it, and that is the whole setup. Each service keeps its own key, so switching back and forth costs nothing.

Nothing else has to be configured before the first dictation or the first recording.

## Dictate

1. Put the cursor where the words should land, in any application.
2. Press **Super+Space**. A panel appears at the bottom of the screen you are working on and Murmur starts listening.
3. Speak. With Grok or Mistral the transcription appears in the panel while you are still talking; with OpenRouter it arrives when you stop.
4. Press **Enter** (or Super+Space again). The panel closes and the text is inserted.

## The keys

| Key | What it does |
| --- | --- |
| **Super+Space** | Starts the dictation, and ends it the same way Enter does. Works whatever is focused |
| **Enter** | Stops and delivers the transcription to the destination the panel names |
| **Ctrl+Enter** | Stops and copies to the clipboard, whatever the panel says it would do |
| **Esc** | Cancels. Nothing is inserted, nothing is copied |

All of those except **Super+Space** reach the panel while it is on screen, which is exactly while it holds the keyboard. See [Keeping your hands free](#keeping-your-hands-free).

The keyboard starts on **Stop**, which is why `Enter` delivers. `Tab` moves it along the panel's buttons, and `Enter` or `Space` presses the one it is on.

## Keeping your hands free

The panel takes nothing over. While it is listening you can click into another window, scroll, and carry on working; the microphone keeps running.

There is one rule, and everything else follows from it: **the panel is on screen exactly while it has your keyboard.**

- **It opens with the keyboard**, so `Enter`, `Ctrl+Enter` and `Esc` work straight away.
- **It opens where you are.** With more than one monitor, the panel appears on the one whose window has focus, and on the pointer's when nothing is focused. Move screens and bring it back, and it comes back on the new one.
- **Look anywhere else and it collapses.** Click another window, click the window you were already in, press `Super` for the overview, alt-tab: the keyboard goes back where you sent it and the panel gets out of the way rather than sitting there swallowing keys.
- **The dictation carries on.** A red indicator with the countdown stays in the top bar; click or tap it to bring the panel back, keyboard and all.
- **Super+Space always stops**, collapsed or not.

So the panel is never in a state where it is visible but ignoring you, and your keystrokes only ever go to one place.

If you would rather nothing appeared over your work at all, turn off **Show the panel when a dictation starts** in the preferences. A dictation then begins collapsed: just the indicator in the top bar, and the panel when you ask for it.

## Where the words go

Murmur asks the question when you stop, and the panel names the answer above the transcription the whole time you are speaking.

- **A text field is focused.** It reads *Types into Text Editor*, naming the application, and `Enter` puts the transcription there. **Copy** is there too, for the times the words belong on the clipboard instead.
- **Nothing can take text.** It reads *Copies to the clipboard*, `Enter` copies, and the panel confirms it before closing. **Copy** is not offered, because it is what stopping already does.

Because the answer is read at the end rather than the start, you can press the shortcut anywhere, start talking, and click into the field you actually want while you speak. `Ctrl+Enter` sends the words to the clipboard instead whenever you would rather keep them than place them. [Where the text goes](text-insertion.md) explains how the decision is made and which applications are recognised.

## Look back at what you said

Every dictation is kept, so a transcription that landed in the wrong place is one click away rather than gone. Open the preferences and switch to the **History** page:

- **Click a dictation** to copy it to the clipboard.
- **Search** them from the magnifier in the header.
- **Clear history** empties the lot, after asking.

The newest 500 are kept, in plain text, in `~/.local/state/murmur@roman-16.github.io/history.jsonl`. **Remember what I dictate**, at the top of the page, turns it off; a password field and a dictation you cancelled are never kept either way. See [Privacy](privacy.md).

## Change the shortcuts

In the preferences, click the shortcut next to **Dictation shortcut** or **Recording shortcut**, press the combination you want, and it takes effect straight away. `Backspace` clears it, which disables the shortcut entirely; `Esc` keeps the old one.

## Hands-free stops

Two settings end a dictation without you pressing anything:

- **Stop after silence** ends it after a number of seconds without speech. Off by default.
- **Maximum dictation time** ends it after ten minutes, so a forgotten dictation cannot run forever. The countdown is in the panel and in the top-bar indicator. OpenRouter holds this to ten minutes, which is as much as it transcribes at a stretch; with Grok or Mistral it goes as high as you like.

Both deliver the transcription exactly as `Enter` would. See [Configuration](configuration.md).

A transcription is always one line, so a list the model makes arrives inline, and nothing Murmur types is ever an `Enter`: dictating into a chat box sends nothing until you press it yourself.

## Record everything you hear and say

A dictation is you talking into a field. A recording is everything: whatever your computer plays - the other people in a Teams, Meet or Discord call, a video, a talk - and your microphone, mixed into one file for as long as it takes.

1. Press **Super+Alt+Space**. A pill with a headset and a running time appears in the top bar, and nothing else: the keyboard stays with whatever you were doing.
2. Carry on. Click the pill to see what the **Microphone** and the **Desktop audio** are hearing, which is the quick way to know the call is really being picked up. With Mistral or OpenRouter the menu also says when the recording will stop by itself, three and two hours in.
3. Press **Super+Alt+Space** again, or **Stop and transcribe** in the pill's menu. The pill says *Transcribing…* while the service works, and a notification says when it is done: **Open** shows the transcript, **Copy** puts it on the clipboard.

**Discard…** in the menu throws the recording away, after asking.

Both files land in `~/Documents/Murmur`, named by the moment the recording started:

| File | What it is |
| --- | --- |
| `2026-03-26T22-02-34.opus` | The audio, Ogg Opus at 24 kbit/s: good for speech, and about 11 MB an hour |
| `2026-03-26T22-02-34.md` | The transcript, exactly as the service sent it back. No speaker names, no timestamps, nothing added |

The recording carries on while the screen is locked, and the pill stays in the lock screen's top bar so it is plain that it does; its menu opens again once you unlock. A dictation, by contrast, ends when the screen locks.

A recording that cannot be transcribed - no network, a key that was refused - keeps its audio, and the notification offers **Retry**. One that never got that far, because the session ended mid-recording or the notification was dismissed, is offered again the next time you log in, with **Transcribe** or **Leave it**.

Tell the people you are recording. Their voices go to the service as well as yours.
