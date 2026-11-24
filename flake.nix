{
  description = "Voice dictation and recording for GNOME: press a shortcut, speak, and the words land in the focused text field, or record everything you hear and say and get its transcript";

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
      engine = builtins.fromJSON (builtins.readFile ./src/lib/transcription/engine.json);

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
          inherit (pkgs) lib;
          metadataFile = pkgs.writeText "metadata.json" (
            builtins.toJSON (metadata // { "version-name" = version; })
          );

          # The same pinned files the preferences download, so a Nix install runs
          # the engine version the extension was written against, with nothing to
          # download and its libraries pointed at the store's.
          machine = pkgs.stdenv.hostPlatform.parsed.cpu.name;
          pinned = builtins.filter (file: (file.machine or machine) == machine) engine.files;
          fetched =
            file:
            pkgs.fetchurl {
              inherit (file) name sha256 url;
            };
          wheel = prefix: fetched (lib.findFirst (file: lib.hasPrefix prefix file.name) null pinned);
          native = pkgs.python3Packages.buildPythonPackage {
            pname = "transcribe-cpp-native";
            inherit (engine) version;
            format = "wheel";
            src = wheel "transcribe_cpp_native-";
            nativeBuildInputs = [ pkgs.autoPatchelfHook ];
            buildInputs = [
              pkgs.stdenv.cc.cc.lib
              pkgs.vulkan-loader
            ];
          };
          binding = pkgs.python3Packages.buildPythonPackage {
            pname = "transcribe-cpp";
            inherit (engine) version;
            format = "wheel";
            src = wheel "transcribe_cpp-";
            dependencies = [ native ];
            pythonImportsCheck = [ "transcribe_cpp" ];
          };
          python = pkgs.python3.withPackages (_: [ binding ]);
          helperModels = builtins.filter (file: file.purpose != "engine") pinned;
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
              cp src/lib/transcription/engine.json src/lib/transcription/engine.py dist/lib/transcription
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
              engine=$out/share/gnome-shell/extensions/${metadata.uuid}/engine
              install -d $engine/files
              ln --symbolic ${python}/bin/python3 $engine/python
              ${lib.concatMapStrings (
                file: "ln --symbolic ${fetched file} $engine/files/${file.name}\n"
              ) helperModels}
              echo ${engine.version} > $engine/ready
              runHook postInstall
            '';

            # Home Manager reads the UUID off the package to enable the extension.
            passthru.extensionUuid = metadata.uuid;

            meta = {
              description = "Voice dictation and recording for GNOME";
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
