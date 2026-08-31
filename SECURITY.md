# Security Policy

## Reporting a vulnerability

**Please do not report security issues through public issues or pull requests.**

Use one of these private channels instead:

1. **Preferred** - open a [private security advisory](https://github.com/roman-16/murmur/security/advisories/new). It is scoped to the maintainer and allows a fix to be prepared privately.
2. **Alternative** - email <roman@lerchster.dev> with `[murmur security]` in the subject.

Please include what the issue is and what it lets an attacker do, how to reproduce it, the Murmur version (`gnome-extensions info murmur@roman-16.github.io`), and your GNOME Shell version and session type.

You can expect an acknowledgement within 7 days and an assessment within 14. If you hear nothing in a week, follow up, because the message was probably missed.

## Supported versions

Only the latest release receives fixes. There is no maintenance branch.

## What is in scope

Murmur runs **inside the GNOME Shell process**, so a flaw here is a flaw in the compositor. Reports about any of the following are welcome:

- Anything that lets another process or a web page read your API key, your audio or your transcription.
- Anything that makes Murmur insert or copy text that did not come from your own dictation, or deliver it to the wrong client.
- Keeping a dictation delivered into a field the client reported as a password, or writing the history anywhere other than the extension's own directory under `$XDG_STATE_HOME`, with the directory at `0700` and the file at `0600`.
- Failure to release the microphone, or to stop recording on cancel.
- Certificate or endpoint handling on the connection to a transcription service, or a key reaching the wrong one of them.
- Command injection or unsafe argument handling in the subprocesses Murmur spawns, `pw-record` and `dotool`.

## What is not in scope

- **The API key is stored unencrypted in dconf.** This is documented in [Privacy](docs/privacy.md). GNOME extensions have no access to the system keyring, so every setting, including this one, is readable by anything running as your user. That is the platform, not a defect.
- **Audio is sent to the transcription service you selected**, Mistral or Google. That is what the extension does. Their handling of it is governed by your agreement with them, and Google's free tier states that it uses the audio to improve their products.
- **The transcription is placed on the clipboard** when no text field is focused, where a clipboard manager may keep it. The panel names that destination while you speak, and `Ctrl+Enter` takes it deliberately.
- **The dictation history is stored unencrypted**, in `~/.local/state/murmur@roman-16.github.io/history.jsonl`, and is readable by anything running as you. This is the same platform limit as the API key, it is documented in [Privacy](docs/privacy.md), and **Remember what I dictate** turns it off. A password field an XWayland client never announced as one is part of that limit rather than a defect in Murmur.
- **`/dev/uinput` access for dotool.** Granting it is a deliberate local decision, and its consequences belong to dotool.
- Vulnerabilities in GNOME Shell, mutter, PipeWire, dotool, the Mistral API or the Gemini API themselves. Report those upstream; if Murmur can mitigate one, say so here as well.
