# Troubleshooting

## The shortcut does nothing

- **The extension is not enabled.** `gnome-extensions info murmur@roman-16.github.io` shows the state. On Wayland a freshly installed extension only appears after you log out and back in.
- **Another shortcut owns the combination.** GNOME gives a key combination to one binding only. Check *Settings → Keyboard → View and Customize Shortcuts*, or set a different one in Murmur's preferences.
- **The shortcut is unset.** The preferences show `Disabled` if it was cleared with `Backspace`.

## "Set your Mistral API key" or "Set your Gemini API key"

The service selected under **Service** has no key in the settings. The notification names which one it wants. See [Getting started](getting-started.md).

If it names a service you did not mean to use, the **Service** row is set to it; switching back finds the other key exactly where you left it.

## "pw-record not found; install PipeWire"

Murmur records with `pw-record`, which ships with PipeWire. Install your distribution's PipeWire tools package (`pipewire` on most, `pipewire-utils` or similar on some) and try again.

## The panel opens but no text appears

- **Check the microphone.** *Settings → Sound → Input* should show the level moving while you speak. Murmur records from the default input device.
- **Check the key.** A key that is invalid, expired or out of quota surfaces as an error notification carrying the service's own words - Gemini says *API key not valid. Please pass a valid API key.*
- **Check the network.** Transcription is a live connection to `api.mistral.ai` or `generativelanguage.googleapis.com`, depending on the service; without it the recording produces nothing.
- **"The service did not start a transcription session"** means the connection was accepted and then went quiet, which is the service's end being unwell rather than anything local. Try again, and try the other service.

## It copied to the clipboard when I expected typing

Murmur did not see a focused text field **at the moment you stopped**. Either nothing was focused, or the application does not report its fields to the compositor. The panel names the destination while you speak, so this is visible before you stop.

One case worth knowing: if you left the recording panel holding the keyboard and never clicked into a field, whatever was focused when you pressed the shortcut is still the destination. Clicking the desktop, or closing the window you were in, leaves nothing to type into.

- To find out whether the application reports at all, turn on *Settings → Accessibility → Screen Keyboard* and click into the field. If GNOME's own keyboard does not appear either, the application is not reporting, and Murmur cannot know.
- Electron applications under XWayland are the usual case. On NixOS, `NIXOS_OZONE_WL=1` moves them to Wayland; elsewhere `--ozone-platform-hint=auto` does the same.

See [Where the text goes](text-insertion.md).

## It typed into the wrong place

The text goes wherever a text field is focused **when you stop**, which is what lets you click into the right field while speaking. It also means an application that takes focus by itself near the end can take the transcription. The panel names the destination the whole time; if it says the wrong thing, click into the field you want before stopping, or use `Ctrl+Enter` to copy instead.

## The panel disappeared while I was still recording

It collapsed, which it does the moment you look anywhere else: another window, the window you were already in, the overview, alt-tab. The panel is on screen exactly while it holds your keyboard, so that it is never both visible and ignoring you.

The recording is still running. The indicator with the countdown is in the top bar; click it to bring the panel back, or press the recording shortcut to stop and deliver.

## A dictation arrived as several chat messages

**Tidy up what I say** formats a spoken list as a bulleted one, and Murmur types each line break as `Enter`, which a chat box reads as *send*. Turn the setting off, or press `Ctrl+Enter` to take the text to the clipboard and paste it yourself.

## Characters are dropped, doubled or reordered

Lower **Typing speed** in the preferences; some Electron and Java applications cannot keep up with fast synthetic input.

## Emoji or accented characters come out wrong

You are on the virtual keyboard fallback, which can only produce characters from your current keyboard layout. Install dotool, which types arbitrary Unicode. See [dotool](text-insertion.md#dotool).

## The preferences say dotool is not available

The status row names the reason: not installed, `/dev/uinput` missing, your user not in the group that owns it, or a group membership this session has not picked up yet, which a log out and back in fixes. Follow [dotool](text-insertion.md#dotool), then press the refresh button.

Wayland applications do not need dotool at all, so this row can be safely ignored if you never dictate into XWayland applications.

## The recording stops on its own

- **Stop after silence** is set and the room is quiet enough to trigger it. Raise it, or set it to 0.
- **Maximum recording time** was reached. Ten minutes by default.
- **The service ended the session.** Gemini transcribes for ten minutes at a stretch, so with it selected the countdown starts there whatever **Maximum recording time** says.

Both deliver what was transcribed so far; nothing is thrown away.

## Reading the log

Everything Murmur reports goes to the shell's journal:

```bash
journalctl --user --follow /usr/bin/gnome-shell | grep --ignore-case murmur
```

Include those lines when [opening an issue](https://github.com/roman-16/murmur/issues).
