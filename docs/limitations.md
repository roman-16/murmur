# Limitations

Some of these are deliberate, some are the platform, and some are simply not built yet. All of them are worth knowing before you rely on Murmur.

## Wayland only

Murmur reads which client holds a focused text field from the compositor, and it is a GNOME Shell extension besides. An X11 session offers neither, so the extension is useless there. XWayland *applications* inside a Wayland session are fine; an X11 session is not.

## GNOME Shell 47 to 50

Extensions are compiled against the shell's own JavaScript API, which changes every release. Older or newer versions are not supported until they are tested.

## It needs the network and an API key

Transcription happens on xAI's, Mistral's or OpenRouter's servers. There is no offline mode and no local model, so no network means no dictation, and every dictation and recording is billed to the key you gave it. A recording made offline keeps its audio and asks to be transcribed once it can be. [Privacy](privacy.md) covers the trade-off in full.

The three services are the three that exist. OpenRouter opens up every transcription model it serves, but there is no way to point Murmur at a service it does not know, or at something self-hosted, without editing the code.

## With Mistral or OpenRouter, nothing appears until you stop

Mistral and OpenRouter transcribe a dictation in one request when you stop, and the words arrive together a moment later: OpenRouter has no streaming transcription API, and Mistral's costs twice what its model for files does. The panel still shows the level, the countdown and where the text will land, but the transcription itself cannot be watched as it is spoken. Grok can, which is the reason to pick it.

A dictation either of them fails is lost whole, since nothing had arrived before it failed; with Grok, the words already shown are copied to the clipboard.

## With Mistral or OpenRouter, a dictation ends after ten minutes

**Maximum dictation time** goes no higher than that with Mistral or OpenRouter, which have to be handed the whole dictation in one piece, held in memory until then. Grok imposes nothing of its own, so with it a dictation runs for as long as you set, up to a day.

## A long recording goes up in pieces

Every service takes only so much audio in one request, and how much depends on the model: Mistral's takes as much as fits in its context beside the names and terms, and OpenAI's newer models take no more than 23 minutes. A recording is therefore sent in pieces of at most ten minutes, cut where it is quietest in the minute before each mark, each with fifteen seconds of its neighbours, and what both heard is written once. That half minute costs a little more audio, about 5%.

OpenRouter's providers give a request about a minute, so a model slow on ten minutes of audio can still fail a piece. The audio stays, for a **Retry** or another service.

## Who spoke is only as good as where it was heard

Your lines are yours because they came in on your microphone, which makes them certain - and makes everything else the microphone hears yours too. Several people in one room share your microphone and your name.

Everyone on a call shares the desktop's channel, and only the service can tell their voices apart. It numbers them within a piece, and a number carries over to the next piece only for someone who speaks in the half minute both pieces heard; whoever is silent there comes back with a new one. A voice from a game or a video is a speaker like any other. Grok labels each word on its own and sometimes changes its mind mid-sentence, which splits that sentence over two lines. With an OpenRouter model that cannot tell speakers apart, the call's lines all read `Others`, and with one that gives no times, a piece is one line at the moment it starts, the half minute it shares with the next written twice.

Asking the same service again gets much the same transcript, mistakes included. Transcribing a file again is for trying another service or another model.

## A recording is billed for each side

The microphone and the desktop go to the service as separate requests, each billed for its full length, so an hour of a call where both sides talk throughout is billed as two. A channel with nothing on it for a whole ten-minute piece, a muted microphone or a call that has not started, is not sent.

## Over loudspeakers, the others are heard twice

Over loudspeakers your microphone hears the others as well as you, a moment after the desktop audio already did, so their words turn up a second time under your name. Headphones keep the two channels apart.

## Any other file is one track

A file without Murmur's two channels - a voice memo, a downloaded talk, a recording with everything mixed into one track - is transcribed as one track: every voice in it is numbered by the service, yours included.

## A recording hears the default output

The desktop half of a recording is the monitor of your default output, and it follows the default when that changes. An application that plays through a different device than the default is not in the recording.

## Your microphone is recorded even when a call has you muted

A recording takes the microphone straight from PipeWire, not from the call, so muting yourself in Teams, Meet or Discord mutes you for the others and not for the recording.

## A terminal is one big text field

A terminal tells the compositor that it accepts text whenever it is focused, and nothing more. Murmur therefore cannot tell a shell prompt from vim in normal mode from a TUI waiting for a single key, and will deliver a sentence to all three. This is inherent: no application outside the terminal can see inside it.

## An application that does not report its fields looks empty

Detection is positive evidence only. Murmur can prove a text field exists, never that one does not, so an application that keeps its focus to itself is treated as having nowhere to put text and gets the clipboard path, which leaves the transcription one paste away. In practice this is limited to older Electron builds and toolkits without Wayland text-input support.

## An X11 field is only recognised after you have used it once

X11 applications report their fields through ibus, which Murmur learns about from events rather than by asking. Until the first focus change after the extension starts, it has heard nothing, so a field that already had focus reads as no field and the transcription goes to the clipboard. Clicking into the field once settles it for the rest of the session.

## The panel is not a window

A GNOME Shell extension runs inside the compositor, so it has no client to hand the window manager and everything it draws is shell chrome. The dictation panel therefore cannot be alt-tabbed to, minimised, dragged, or pushed behind an application: chrome is always drawn above windows.

What it does instead is get out of the way. Clicking anything else collapses the panel, leaving the indicator and its countdown in the top bar, and clicking that indicator brings the panel back. A window pushed behind a maximised application would show you nothing at all; the top bar keeps the dictation in sight.

## The panel shows the last four lines

The transcription is a caption, not a document: it follows the newest words and older lines scroll out of sight, with no way to scroll back while you are still speaking. Nothing is lost - the whole dictation is what gets typed or copied when you stop, and it is in the history afterwards.

## The virtual keyboard is limited to your layout

Without dotool, the typing path can only produce characters that exist on your current keyboard layout. Typographic quotes, dashes and non-breaking spaces are rewritten to plain equivalents; emoji and other scripts are dropped. dotool removes the limit entirely.

## Your dictation history is plain text

Every dictation is kept in `~/.local/state/murmur@roman-16.github.io/history.jsonl`, unencrypted, because a GNOME extension has no keyring. Anything running as you can read it. A field the application reports as a password is skipped, but only Wayland applications report it, so a password dictated into an XWayland application would be kept. **Remember what I dictate** turns the whole thing off.

## No editing, no commands, no punctuation by voice

Murmur transcribes and inserts. It has no vocabulary for "delete that", no dictation commands and no formatting rules beyond what the model produces. Punctuation is whatever the model infers.

## A transcription is always one line

Every line break the model produces is flattened to a space before the transcription is shown, typed or copied, because Murmur types a line break as `Enter`, and `Enter` means *send* in a chat box, *run* in a shell and *search* in a filter. A dictated list therefore arrives with its bullets inline, and there is no way to get the line breaks back, `Ctrl+Enter` included.

## One language at a time, chosen by the model

There is no language setting. Every service detects the language from what it hears, and none is told which one to expect. Voxtral works well for a single language and less well when you switch mid-sentence; Grok is built to follow a switch; what an OpenRouter model does is the model's own business. Nothing in Murmur biases any of them towards the language you actually speak.

## Only one key is guaranteed to reach Murmur

`Enter`, `Ctrl+Enter` and `Esc` reach the panel only while it is on screen, and looking anywhere else collapses it. That is the point, but it means the dictation shortcut is the only key that always works. To cancel a dictation you have clicked away from, click the top-bar indicator to bring the panel back, then `Esc` or **Cancel**.
