# Limitations

Some of these are deliberate, some are the platform, and some are simply not built yet. All of them are worth knowing before you rely on Murmur.

## Wayland only

Murmur reads which client holds a focused text field from the compositor, and it is a GNOME Shell extension besides. An X11 session offers neither, so the extension is useless there. XWayland *applications* inside a Wayland session are fine; an X11 session is not.

## GNOME Shell 47 to 50

Extensions are compiled against the shell's own JavaScript API, which changes every release. Older or newer versions are not supported until they are tested.

## It needs the network and an API key

Transcription happens on Mistral's servers. There is no offline mode and no local model, so no network means no dictation, and every dictation is billed to your key. [Privacy](privacy.md) covers the trade-off in full.

## A terminal is one big text field

A terminal tells the compositor that it accepts text whenever it is focused, and nothing more. Murmur therefore cannot tell a shell prompt from vim in normal mode from a TUI waiting for a single key, and will deliver a sentence to all three. This is inherent: no application outside the terminal can see inside it.

## An application that does not report its fields looks empty

Detection is positive evidence only. Murmur can prove a text field exists, never that one does not, so an application that keeps its focus to itself is treated as having nowhere to put text and gets the clipboard path, which leaves the transcription one paste away. In practice this is limited to older Electron builds and toolkits without Wayland text-input support.

## An X11 field is only recognised after you have used it once

X11 applications report their fields through ibus, which Murmur learns about from events rather than by asking. Until the first focus change after the extension starts, it has heard nothing, so a field that already had focus reads as no field and the transcription goes to the clipboard. Clicking into the field once settles it for the rest of the session.

## The virtual keyboard is limited to your layout

Without dotool, the typing path can only produce characters that exist on your current keyboard layout. Typographic quotes, dashes and non-breaking spaces are rewritten to plain equivalents; emoji and other scripts are dropped. dotool removes the limit entirely.

## The destination is decided once

Murmur decides where the text goes when you press the shortcut, announces it, and honours that decision. It does not re-check afterwards, because the overlay's promise should hold and because an application can be slow to take its focus back. If something steals focus mid-recording, press `Esc`.

## No editing, no commands, no punctuation by voice

Murmur transcribes and inserts. It has no vocabulary for "delete that", no dictation commands and no formatting rules beyond what the model produces. Punctuation is whatever Voxtral infers.

## One language at a time, chosen by the model

There is no language setting. Voxtral detects the language from what it hears, which works well for a single language and less well when you switch mid-sentence.

## The overlay takes over the keyboard

While recording, the overlay is modal: your keystrokes go to it, not to the application underneath. That is what makes `Enter`, `Ctrl+Enter` and `Esc` work without stealing them from anything, and it is why you cannot click into a different field while a recording is running.
