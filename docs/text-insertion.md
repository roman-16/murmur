# Where the text goes

Murmur asks one question the moment you stop: **can anything on screen receive text right now?** The answer decides where the transcription goes, and the panel states the current answer for the whole recording.

## The decision

Applications tell the compositor when a text field takes focus, because that is how input methods and the on-screen keyboard work. Murmur reads the same signal GNOME's own keyboard reads.

| The client says | Murmur concludes |
| --- | --- |
| A Wayland client enabled its text input | A field is focused, and the shell can reach it directly |
| An X11 client focused an ibus input context | A field is focused, and it has to be typed into |
| Nothing at all | There is nowhere to put text |

The check runs when the recording ends, and the panel shows the current answer while you speak, updating as you click around. It can, because the panel never takes an application's text-input focus away: it borrows the keyboard from the compositor's stage rather than from the window, so the window stays focused as far as the application is concerned.

So you can press the shortcut anywhere, start talking, and go and click into the field the words belong in while you are still speaking.

**A quick way to check any application yourself:** turn on *Settings → Accessibility → Screen Keyboard* and click into the field. If GNOME's on-screen keyboard appears, that field is one Murmur recognises, because both read the same signal.

## The two paths

| Path | When | What happens |
| --- | --- | --- |
| **Typing** | Something has a focused field when you stop | Keystrokes are synthesized with [dotool](#dotool), or with the shell's virtual keyboard if dotool is unavailable |
| **Clipboard** | Nothing has a focused field when you stop | The text is copied to the clipboard and the panel says so before closing. Nothing is typed, so a stray transcription cannot trigger shortcuts in whatever happens to be focused |

Text arrives as keystrokes because that is the one thing every application that accepts a keyboard understands. Handing the whole transcription over through the compositor's input method instead would be faster and exact, but a client is free to accept it and do nothing with it, and nothing in the protocol reports back: web-based terminals such as the one in VS Code read only key events, so a transcription delivered that way disappears without a trace. Keystrokes cannot go missing that quietly.

The clipboard path is the reason the feature exists. Typing into an application with no text field does not lose the words quietly, it presses keys: in Files that starts a search, on a web page it fires single-key shortcuts, in a mail client it can archive or delete. Murmur refuses to gamble and hands you the text instead.

**`Ctrl+Enter` always copies**, whatever the panel says it would do, as does the panel's **Copy** button. Use it when the words are meant for somewhere other than the field in front of you, or when you want to keep them rather than place them.

## Which applications are recognised

| Application | Recognised | Notes |
| --- | --- | --- |
| GTK 3 and GTK 4 apps | Yes | Per focused field |
| GNOME Terminal, Console, Ptyxis, any VTE terminal | Yes | The terminal reports a focused field whenever it is focused |
| WezTerm, Kitty, Alacritty and other Wayland terminals | Yes, when they implement text input | WezTerm enables it whenever its window has keyboard focus |
| Firefox | Yes | Per focused field |
| Chromium, Chrome, Brave, Edge | Yes, from Chromium 136 | Text input is enabled by default from that version; older builds need `--enable-wayland-ime` |
| Electron apps running on Wayland | Yes, with a recent Chromium | Includes editors and chat apps. On NixOS this needs `NIXOS_OZONE_WL=1` |
| Electron and other apps under XWayland | Yes, through ibus | Recognised as a field like any other |
| Qt 6 apps | Yes | Qt uses the same Wayland text-input protocol |
| Games, video players, anything without a text field | No | Clipboard, which is the point |

### Terminals are one big text field

A terminal reports a focused field whenever it is focused, and it cannot report anything finer, because the compositor has no idea what is running inside it. A shell prompt, a text editor in insert mode and a TUI waiting for a single keypress all look identical from outside.

So Murmur will happily deliver a sentence to a terminal running vim in normal mode, where those characters are commands. That is not something detection can fix; it is the same as typing the sentence yourself.

## dotool

dotool is only needed for the typing path, which means only for XWayland applications. If everything you dictate into runs on Wayland, you never need it.

1. Install `dotool` from your distribution, or from [its homepage](https://sr.ht/~geb/dotool/).
2. Give your user access to `/dev/uinput`. dotool ships a udev rule; in practice this means joining the `input` group: `sudo usermod --append --groups input $USER`.
3. Log out and back in, so the new group membership applies.

The preferences show a live status row with a refresh button, which names exactly what is missing.

Optionally run the `dotoold` daemon, which makes typing faster. In daemon mode dotool reads the keyboard layout from the daemon's own environment rather than from Murmur, so start it with `DOTOOL_XKB_LAYOUT` (and `DOTOOL_XKB_VARIANT`) set to match your layout.

Without dotool, typing falls back to the shell's virtual keyboard, which can only produce characters that exist on your **current keyboard layout**. Murmur rewrites typographic quotes, dashes and non-breaking spaces to plain equivalents for that path; anything else outside your layout, such as emoji or another script, is dropped. This is the one path where the text you get can differ from the text you saw in the panel.

## Passwords

A password field is still a text field, so a dictated password is typed into it, never goes near the clipboard, and is never kept in your [dictation history](configuration.md#remember-what-i-dictate). That last one holds as far as the application says so: Wayland clients announce a password field and are honoured, XWayland clients announce nothing and a password dictated into one would be kept.

Whether dictating a password aloud is a good idea is a separate question.
