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

      # CHANGELOG.md declares the version: its newest section is what the
      # release workflow publishes and what the extension reports.
      version =
        let
          lines = nixpkgs.lib.splitString "\n" (builtins.readFile ./CHANGELOG.md);
          headings = builtins.filter (match: match != null) (
            map (builtins.match "## [[]([0-9]+[.][0-9]+[.][0-9]+)[]].*") lines
          );
        in
        builtins.elemAt (builtins.head headings) 0;
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          metadataFile = pkgs.writeText "metadata.json" (
            builtins.toJSON (metadata // { "version-name" = version; })
          );
        in
        {
          default = pkgs.stdenv.mkDerivation {
            pname = "gnome-shell-extension-murmur";
            inherit version;

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
                LICENSE src/stylesheet.css
              install -Dm444 ${metadataFile} \
                $out/share/gnome-shell/extensions/${metadata.uuid}/metadata.json
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
        }
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
