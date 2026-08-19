{
  description = "Voice dictation for GNOME: press a shortcut, speak, and the words land in the focused text field";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      metadata = builtins.fromJSON (builtins.readFile ./metadata.json);
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.stdenv.mkDerivation {
          pname = "gnome-shell-extension-murmur";
          version = metadata."version-name";

          src = self;

          nativeBuildInputs = [
            pkgs.glib.dev
            pkgs.typescript
          ];

          # The GNOME Shell type definitions are published on npm only, so the
          # build emits without checking and `just lint` verifies the types.
          buildPhase = ''
            runHook preBuild
            tsc --noCheck
            glib-compile-schemas --strict schemas
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            install -Dm444 -t $out/share/gnome-shell/extensions/${metadata.uuid} \
              LICENSE metadata.json src/stylesheet.css
            cp --recursive dist/. schemas $out/share/gnome-shell/extensions/${metadata.uuid}
            runHook postInstall
          '';

          # Home Manager reads the UUID off the package to enable the extension.
          passthru.extensionUuid = metadata.uuid;

          meta = {
            description = "Voice dictation for GNOME";
            homepage = metadata.url;
            license = pkgs.lib.licenses.mit;
            platforms = pkgs.lib.platforms.linux;
          };
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
