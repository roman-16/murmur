# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Adding a version section here is what publishes a release, so this file is the one place a version is decided: see [Releasing](CONTRIBUTING.md#releasing). Versions that shipped before this file existed are on the [releases page](https://github.com/roman-16/murmur/releases).

## [1.6.1] - 2026-08-28

### Changed

- A transcription arrives as one line whatever the service sends: a tidied list keeps its bullets inline rather than spread across several lines, and no key, `Ctrl+Enter` included, gets the line breaks back.

### Fixed

- A dictation no longer submits itself partway through: a line break in the transcription was typed as `Enter`, which sent the chat message, ran the shell command or started the search before the rest of the sentence arrived.

## [1.6.0] - 2026-08-27

### Added

- A choice of transcription service: Gemini 3.5 Transcribe Live alongside Mistral Voxtral Realtime, chosen in the preferences, each with its own API key. Gemini's free tier costs nothing and, by Google's own pricing page, uses what you dictate to improve their products.
- **Tidy up what I say**, on by default with Gemini: filler words dropped, a spoken correction resolved rather than transcribed, and a spoken list formatted as one. Turn it off to have what you said transcribed word for word.

### Changed

- **Gemini is the service Murmur transcribes with.** An installation that never picked one switches over on update and needs a key from aistudio.google.com/apikey; setting **Service** back to Mistral finds your Mistral key exactly where it was.
- The panel is laid out at the scale GNOME uses for its own dialogs rather than its menus: more room around everything, larger transcription text, taller Copy and Stop buttons, and a transcription that grows from three lines to eight while you speak.
- A recording lasts ten minutes at most while Gemini is the service, because that is where Google ends a live transcription, so the countdown starts there however high **Maximum recording time** goes.

### Fixed

- A recording whose connection drops, or whose API key the service turns down, says so in the service's own words instead of ending as an empty transcription that inserts nothing.
- A transcription whose last words never arrive no longer leaves the panel on **Finishing…**: after five seconds Murmur delivers what it has.

## [1.5.0] - 2026-08-26

### Changed

- The panel opens on the screen you are working on - the one whose window has focus, or the pointer's when nothing is focused - rather than always the primary monitor.
- The panel keeps clear of a dock or panel along the bottom of the screen, sitting above the space they reserve instead of against the screen edge.
- The panel's controls moved: collapse and cancel are the two buttons in its header, and Copy and Stop sit side by side along the bottom, with Stop, the one Enter presses, on the right.
- The panel is roomier - a wider card, more space around everything in it and about four lines of transcription in view - and its spacing follows your text size rather than staying at fixed pixels.

## [1.4.0] - 2026-08-25

### Added

- A recording indicator in the top bar shows the countdown while Murmur listens, and opens or closes the panel when you click it.
- **Show the panel when recording starts**, on by default. Turn it off and a recording begins with nothing over your work, just the top-bar indicator.

### Changed

- Recording no longer takes over the screen. Click into another window, scroll a page and keep typing while Murmur listens; the panel collapses to the top-bar indicator whenever you look elsewhere, and `Super+Space` still stops from anywhere.
- The transcription goes wherever a text field is focused when you stop, rather than where one was when you started, so you can begin talking and then click into the field the words belong in. The panel names the destination the whole time.
- `Enter`, `Ctrl+Enter` and `Esc` control the panel only while it is on screen, which is exactly while it holds the keyboard. Click anywhere else and the keyboard is your application's again.
- The panel looks like one of GNOME's own popovers, taking its colours, corners and shadow from your theme, accent colour and contrast setting, including a custom shell theme.

## [1.3.3] - 2026-08-23

### Changed

- A recording runs for up to ten minutes by default, rather than two, so a long dictation is no longer cut off mid-sentence.
- Transcription runs at the **Accurate** delay of 2.4 seconds by default: text trails your voice further in the overlay, and the finished result is steadier.
- Text is typed at 2500 characters a second by default, so a sentence lands almost as one piece. Lower **Typing speed** if an application drops or reorders characters.

## [1.3.2] - 2026-08-17

### Changed

- Murmur's own description states that a transcription goes to the clipboard when no text field is focused, which extensions.gnome.org requires of anything that touches it.

## [1.3.1] - 2026-08-17

### Added

- **Typing speed** reaches 2500 characters a second, which holds no key at all and types as fast as dotool can push the characters through.

### Fixed

- A dictation into a web-based terminal, such as the one in VS Code, no longer disappears. The transcription is typed as keystrokes into every application instead of being handed to the client through the compositor's input method, which a client may accept and do nothing with.

## [1.3.0] - 2026-08-16

### Added

- When nothing on screen can receive text, Murmur copies the transcription to the clipboard and says so, rather than firing a sentence worth of keystrokes at whatever is in front. The overlay names the destination before you speak, and `Ctrl+Enter` copies whatever it says.
