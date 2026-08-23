# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Adding a version section here is what publishes a release, so this file is the one place a version is decided: see [Releasing](CONTRIBUTING.md#releasing). Versions that shipped before this file existed are on the [releases page](https://github.com/roman-16/murmur/releases).

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
