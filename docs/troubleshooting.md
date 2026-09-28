# Troubleshooting

## A shortcut does nothing

- **The extension is not enabled.** `gnome-extensions info murmur@roman-16.github.io` shows the state. On Wayland a freshly installed extension only appears after you log out and back in.
- **Another shortcut owns the combination.** GNOME gives a key combination to one binding only. Check *Settings → Keyboard → View and Customize Shortcuts*, or set a different one in Murmur's preferences.
- **The shortcut is unset.** The preferences show `Disabled` if it was cleared with `Backspace`.
- **The screen is locked.** Neither shortcut listens on the lock screen; a recording already running carries on.

## "Set your xAI API key", or Mistral's or OpenRouter's

The service selected under **Service** has no key in the settings. The notification names which one it wants. See [Getting started](getting-started.md).

If it names a service you did not mean to use, the **Service** row is set to it; switching back finds the other key exactly where you left it.

## OpenRouter reports that the model is unknown

The slug under **Model** is not one OpenRouter serves, which happens to a model that has been retired or set by hand with a typo. Open the **Model** list and pick one: it is fetched from OpenRouter, so it holds exactly what is available now.

## "GStreamer is not installed", or "GStreamer has no … element"

Murmur hears through GStreamer, inside the shell, and needs its base and good plugins and PipeWire's GStreamer plugin. The message names the element that is missing and what provides it; [Installation](installation.md#requirements) lists the package names. Install it, log out and back in, and try again.

## The panel opens but no text appears

- **Check the microphone.** *Settings → Sound → Input* should show the level moving while you speak. Murmur listens to the default input device.
- **Check the key.** A key that is invalid, expired or out of quota surfaces as an error notification carrying the service's own words - Mistral says *Invalid API Key*. xAI turns a key away before a dictation's connection opens, so what reaches you is its status instead: *the service refused the connection (400 Bad Request)* means the key is not one xAI knows.
- **Check the network.** Transcription reaches `api.x.ai`, `api.mistral.ai` or `openrouter.ai`, depending on the service; without it the dictation produces nothing.
- **With OpenRouter, nothing appears until you stop.** That is the service, not a fault: it transcribes the dictation in one go rather than as you speak. See [Limitations](limitations.md).
- **"The service did not start a transcription session"** means the connection was accepted and then went quiet, which is the service's end being unwell rather than anything local. Try again, and try another service.

## It copied to the clipboard when I expected typing

Murmur did not see a focused text field **at the moment you stopped**. Either nothing was focused, or the application does not report its fields to the compositor. The panel names the destination while you speak, so this is visible before you stop.

One case worth knowing: if you left the dictation panel holding the keyboard and never clicked into a field, whatever was focused when you pressed the shortcut is still the destination. Clicking the desktop, or closing the window you were in, leaves nothing to type into.

- To find out whether the application reports at all, turn on *Settings → Accessibility → Screen Keyboard* and click into the field. If GNOME's own keyboard does not appear either, the application is not reporting, and Murmur cannot know.
- Electron applications under XWayland are the usual case. On NixOS, `NIXOS_OZONE_WL=1` moves them to Wayland; elsewhere `--ozone-platform-hint=auto` does the same.

See [Where the text goes](text-insertion.md).

## It typed into the wrong place

The text goes wherever a text field is focused **when you stop**, which is what lets you click into the right field while speaking. It also means an application that takes focus by itself near the end can take the transcription. The panel names the destination the whole time; if it says the wrong thing, click into the field you want before stopping, or use `Ctrl+Enter` to copy instead.

## The panel disappeared while I was still dictating

It collapsed, which it does the moment you look anywhere else: another window, the window you were already in, the overview, alt-tab. The panel is on screen exactly while it holds your keyboard, so that it is never both visible and ignoring you.

The dictation is still running. The indicator with the countdown is in the top bar; click it to bring the panel back, or press the dictation shortcut to stop and deliver.

## Characters are dropped, doubled or reordered

Lower **Typing speed** in the preferences; some Electron and Java applications cannot keep up with fast synthetic input.

## Emoji or accented characters come out wrong

You are on the virtual keyboard fallback, which can only produce characters from your current keyboard layout. Install dotool, which types arbitrary Unicode. See [dotool](text-insertion.md#dotool).

## The preferences say dotool is not available

The status row names the reason: not installed, `/dev/uinput` missing, your user not in the group that owns it, or a group membership this session has not picked up yet, which a log out and back in fixes. Follow [dotool](text-insertion.md#dotool), then press the refresh button.

Wayland applications do not need dotool at all, so this row can be safely ignored if you never dictate into XWayland applications.

## A dictation stops on its own

- **Stop after silence** is set and the room is quiet enough to trigger it. Raise it, or set it to 0.
- **Maximum dictation time** was reached. Ten minutes by default.
- **The service transcribes only so much at a stretch.** OpenRouter stops at ten minutes, so with it selected the countdown starts there whatever **Maximum dictation time** says.
- **The screen was locked.** A dictation ends there, since the focused field on the lock screen is the password.

Each but the last delivers what was transcribed so far; nothing is thrown away.

## The desktop audio level does not move

The recording listens to the monitor of your default output, so sound played through anything else is not heard: a headset set as the call's output but not as the default, for one. Make it the default under *Settings → Sound → Output*, and the recording follows it, even mid-recording. Nothing playing reads as silence, which is correct.

## A recording stops on its own

- **The service's limit was reached**: three hours with Mistral, two with OpenRouter. The pill's menu says when. What was recorded is transcribed.
- **The audio source went away**, which a notification reports as *The recording stopped* with the reason. What was recorded up to then is transcribed.

## "The recording could not be transcribed"

The audio is in `~/Documents/Murmur` whatever the reason, and **Retry** sends it again. The notification carries the service's own words: a key it refused, a file larger than it takes, or, with OpenRouter, a provider that ran out of time on a long recording, in which case another model or another service is the fix. A recording whose notification was dismissed is offered again when you next log in.

## Reading the log

Everything Murmur reports goes to the shell's journal:

```bash
journalctl --user --follow /usr/bin/gnome-shell | grep --ignore-case murmur
```

Include those lines when [opening an issue](https://github.com/roman-16/murmur/issues).
