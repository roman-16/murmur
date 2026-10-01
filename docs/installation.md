# Installation

## Requirements

| | |
| --- | --- |
| **GNOME Shell 47 to 50** | On a **Wayland** session. Murmur reads which client holds a focused field from the compositor, which an X11 session cannot tell it |
| **GStreamer and PipeWire** | Capture the microphone and, while recording, what the computer plays, and encode the recording. The base and good plugins and PipeWire's GStreamer plugin are what GNOME's own screen recorder uses, so a GNOME desktop usually has them already: `gstreamer1-plugins-base`, `gstreamer1-plugins-good` and `pipewire-gstreamer` on Fedora, `gir1.2-gstreamer-1.0`, `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good` and `gstreamer1.0-pipewire` on Debian and Ubuntu, `gst-plugins-base`, `gst-plugins-good` and `gst-plugin-pipewire` on Arch. Murmur names the missing piece when you press a shortcut |
| **An API key** | Transcription runs on Mistral Voxtral by default, on Grok Voice Transcribe 2.0, or on any model OpenRouter transcribes with; each service needs a key of its own, from [console.mistral.ai](https://console.mistral.ai), [console.x.ai](https://console.x.ai) or [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). See [Privacy](privacy.md) for what that means |
| **[dotool](https://sr.ht/~geb/dotool/)** (recommended) | Types arbitrary Unicode into any application. Without it Murmur falls back to the shell's virtual keyboard, which is limited to your keyboard layout. See [Where the text goes](text-insertion.md) |

Check your session with `echo $XDG_SESSION_TYPE`; it has to say `wayland`.

## From a release

Download the [latest release](https://github.com/roman-16/murmur/releases/latest), install it, and clean up after it:

```bash
curl -fLo /tmp/murmur.zip https://github.com/roman-16/murmur/releases/latest/download/murmur@roman-16.github.io.shell-extension.zip && gnome-extensions install -f /tmp/murmur.zip && rm /tmp/murmur.zip
```

Log out and back in, then enable it:

```bash
gnome-extensions enable murmur@roman-16.github.io
```

## From extensions.gnome.org

Murmur's [listing](https://extensions.gnome.org/extension/10343/murmur/) is awaiting review. Once it is approved, the page installs it in one click, and updates arrive through the *Extensions* app like any other extension.

## With Nix

The repository is a flake, so a Home Manager or NixOS configuration installs Murmur declaratively and pins it like everything else:

```nix
inputs.murmur.url = "github:roman-16/murmur";
```

With Home Manager, which enables the extension for you:

```nix
programs.gnome-shell = {
  enable = true;
  extensions = [ { package = inputs.murmur.packages.${pkgs.system}.default; } ];
};
```

On NixOS, where enabling stays a one-off:

```nix
environment.systemPackages = [ inputs.murmur.packages.x86_64-linux.default ];
```

```bash
gnome-extensions enable murmur@roman-16.github.io
```

Either way, log out and back in afterwards. GStreamer and its PipeWire plugin come with GNOME itself, whose shell is wrapped with them, and dotool is `pkgs.dotool` plus membership in the group that owns `/dev/uinput`.

On its own, `nix build` writes the extension to `result/share/gnome-shell/extensions/murmur@roman-16.github.io`.

## From source

Needs [devbox](https://www.jetify.com/devbox) (or Bun, GJS, glib and just installed yourself):

```bash
git clone https://github.com/roman-16/murmur.git
cd murmur
devbox shell        # or: direnv allow
just install
```

`just install` compiles `src/` into `dist/`, compiles the settings schema, and symlinks the result into `~/.local/share/gnome-shell/extensions/`. Log out and back in, then enable it as above.

Because it is a symlink, `just build` is enough to pick up later changes, followed by a shell restart.

## Updating

| Installed from | How to update |
| --- | --- |
| Release zip | Run the install command again, then log out and back in |
| extensions.gnome.org | The *Extensions* app offers the update |
| Nix | `nix flake update murmur` in your configuration, rebuild, then log out and back in |
| Source | `git pull && just install`, then log out and back in |

Wayland cannot restart GNOME Shell in place, so every update needs a log out and back in. There is no way around it.

## Uninstalling

```bash
gnome-extensions disable murmur@roman-16.github.io
gnome-extensions uninstall murmur@roman-16.github.io
```

A source install is a symlink, so remove it by hand:

```bash
rm ~/.local/share/gnome-shell/extensions/murmur@roman-16.github.io
```

A Nix install goes away with the entry in your configuration and the next rebuild.

Your settings, including the API key, live in dconf and outlive the extension, and so does what you dictated. Clear both with:

```bash
dconf reset -f /org/gnome/shell/extensions/murmur/
rm -r ~/.local/state/murmur@roman-16.github.io
```
