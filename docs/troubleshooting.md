# Troubleshooting

## The shortcut does nothing

- **The extension is not enabled.** `gnome-extensions info murmur@roman-16.github.io` shows the state. On Wayland a freshly installed extension only appears after you log out and back in.
- **Another shortcut owns the combination.** GNOME gives a key combination to one binding only. Check *Settings → Keyboard → View and Customize Shortcuts*, or set a different one in Murmur's preferences.
- **The shortcut is unset.** The preferences show `Disabled` if it was cleared with `Backspace`.

## "Set your Mistral API key"

There is no key in the settings. See [Getting started](getting-started.md).

## "pw-record not found; install PipeWire"

Murmur records with `pw-record`, which ships with PipeWire. Install your distribution's PipeWire tools package (`pipewire` on most, `pipewire-utils` or similar on some) and try again.

## The overlay opens but no text appears

- **Check the microphone.** *Settings → Sound → Input* should show the level moving while you speak. Murmur records from the default input device.
- **Check the key.** An invalid or expired key surfaces as an error notification when the socket closes.
- **Check the network.** Transcription is a live connection to `api.mistral.ai`; without it the recording produces nothing.

## It copied to the clipboard when I expected typing

Murmur did not see a focused text field. Either nothing was focused, or the application does not report its fields to the compositor.

- To find out whether the application reports at all, turn on *Settings → Accessibility → Screen Keyboard* and click into the field. If GNOME's own keyboard does not appear either, the application is not reporting, and Murmur cannot know.
- Electron applications under XWayland are the usual case. On NixOS, `NIXOS_OZONE_WL=1` moves them to Wayland; elsewhere `--ozone-platform-hint=auto` does the same.

See [Where the text goes](text-insertion.md).

## It typed into the wrong place

The destination is decided when you press the shortcut, and the text is delivered to whatever holds the focus when the overlay closes. Clicking into another window during a recording is not possible, since the overlay is modal, but an application that steals focus by itself can move the target. Press `Esc` and dictate again.

## Characters are dropped, doubled or reordered

Lower **Typing speed** in the preferences; some Electron and Java applications cannot keep up with fast synthetic input.

## Emoji or accented characters come out wrong

You are on the virtual keyboard fallback, which can only produce characters from your current keyboard layout. Install dotool, which types arbitrary Unicode. See [dotool](text-insertion.md#dotool).

## The preferences say dotool is not available

The status row names the reason: not installed, `/dev/uinput` missing, your user not in the group that owns it, or a group membership this session has not picked up yet, which a log out and back in fixes. Follow [dotool](text-insertion.md#dotool), then press the refresh button.

Wayland applications do not need dotool at all, so this row can be safely ignored if you never dictate into XWayland applications.

## The recording stops on its own

- **Stop after silence** is set and the room is quiet enough to trigger it. Raise it, or set it to 0.
- **Maximum recording time** was reached. Two minutes by default.

Both deliver what was transcribed so far; nothing is thrown away.

## Reading the log

Everything Murmur reports goes to the shell's journal:

```bash
journalctl --user --follow /usr/bin/gnome-shell | grep --ignore-case murmur
```

Include those lines when [opening an issue](https://github.com/roman-16/murmur/issues).
