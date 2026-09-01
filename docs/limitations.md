# Limitations

Some of these are deliberate, some are the platform, and some are simply not built yet. All of them are worth knowing before you rely on Murmur.

## Wayland only

Murmur reads which client holds a focused text field from the compositor, and it is a GNOME Shell extension besides. An X11 session offers neither, so the extension is useless there. XWayland *applications* inside a Wayland session are fine; an X11 session is not.

## GNOME Shell 47 to 50

Extensions are compiled against the shell's own JavaScript API, which changes every release. Older or newer versions are not supported until they are tested.

## It needs the network and an API key

Transcription happens on Mistral's or Google's servers. There is no offline mode and no local model, so no network means no dictation, and every dictation is billed to the key you gave it - or, on Google's free tier, paid for with what you dictate. [Privacy](privacy.md) covers the trade-off in full.

The two services are the two that exist. There is no way to point Murmur at a third one, or at something self-hosted, without editing the code.

## A Gemini recording ends after ten minutes

Google ends a live transcription session there, so with Gemini - the default - **Maximum recording time** goes no higher than ten minutes. Mistral ends no session of its own, so with it a recording runs for as long as you set, up to a day.

## A terminal is one big text field

A terminal tells the compositor that it accepts text whenever it is focused, and nothing more. Murmur therefore cannot tell a shell prompt from vim in normal mode from a TUI waiting for a single key, and will deliver a sentence to all three. This is inherent: no application outside the terminal can see inside it.

## An application that does not report its fields looks empty

Detection is positive evidence only. Murmur can prove a text field exists, never that one does not, so an application that keeps its focus to itself is treated as having nowhere to put text and gets the clipboard path, which leaves the transcription one paste away. In practice this is limited to older Electron builds and toolkits without Wayland text-input support.

## An X11 field is only recognised after you have used it once

X11 applications report their fields through ibus, which Murmur learns about from events rather than by asking. Until the first focus change after the extension starts, it has heard nothing, so a field that already had focus reads as no field and the transcription goes to the clipboard. Clicking into the field once settles it for the rest of the session.

## The panel is not a window

A GNOME Shell extension runs inside the compositor, so it has no client to hand the window manager and everything it draws is shell chrome. The recording panel therefore cannot be alt-tabbed to, minimised, dragged, or pushed behind an application: chrome is always drawn above windows.

What it does instead is get out of the way. Clicking anything else collapses the panel, leaving the recording indicator and its countdown in the top bar, and clicking that indicator brings the panel back. A window pushed behind a maximised application would show you nothing at all; the top bar keeps the recording in sight.

## The panel shows the last four lines

The transcription is a caption, not a document: it follows the newest words and older lines scroll out of sight, with no way to scroll back while you are still speaking. Nothing is lost - the whole dictation is what gets typed or copied when you stop, and it is in the history afterwards.

## The virtual keyboard is limited to your layout

Without dotool, the typing path can only produce characters that exist on your current keyboard layout. Typographic quotes, dashes and non-breaking spaces are rewritten to plain equivalents; emoji and other scripts are dropped. dotool removes the limit entirely.

## Your dictation history is plain text

Every dictation is kept in `~/.local/state/murmur@roman-16.github.io/history.jsonl`, unencrypted, because a GNOME extension has no keyring. Anything running as you can read it. A field the application reports as a password is skipped, but only Wayland applications report it, so a password dictated into an XWayland application would be kept. **Remember what I dictate** turns the whole thing off.

## No editing, no commands, no punctuation by voice

Murmur transcribes and inserts. It has no vocabulary for "delete that", no dictation commands and no formatting rules beyond what the model produces. Punctuation is whatever Voxtral infers.

## Tidying up is the model's judgement, not yours

**Tidy up what I say**, on by default with Gemini, has no dial and no vocabulary of your own. It decides what a filler word is, which spoken correction you meant, and where a list belongs - and it may reformat a sentence you wanted verbatim. The only control is the switch.

## A transcription is always one line

Every line break the model produces is flattened to a space before the transcription is shown, typed or copied, because Murmur types a line break as `Enter`, and `Enter` means *send* in a chat box, *run* in a shell and *search* in a filter. A dictated list therefore arrives with its bullets inline, and there is no way to get the line breaks back, `Ctrl+Enter` included.

## One language at a time, chosen by the model

There is no language setting. Both services detect the language from what they hear, and neither is told which one to expect. Voxtral works well for a single language and less well when you switch mid-sentence; Gemini is built to follow a switch, but nothing in Murmur biases either towards the language you actually speak.

## Only one key is guaranteed to reach Murmur

`Enter`, `Ctrl+Enter` and `Esc` reach the panel only while it is on screen, and looking anywhere else collapses it. That is the point, but it means the recording shortcut is the only key that always works. To cancel a recording you have clicked away from, click the top-bar indicator to bring the panel back, then `Esc` or **Cancel**.
