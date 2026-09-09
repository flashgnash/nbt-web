{
  description = "Web-based NBT editor for a directory of minecraft servers";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        default = nbt-web;
        nbt-web =
          let
            py = pkgs.python3.withPackages (ps: [ ps.nbtlib ]);
          in
          pkgs.stdenvNoCC.mkDerivation {
            pname = "nbt-web";
            version = "0.1.0";
            src = ./nbt_web;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            installPhase = ''
              mkdir -p $out/share/nbt-web $out/bin
              cp -r . $out/share/nbt-web/
              makeWrapper ${py}/bin/python3 $out/bin/nbt-web \
                --add-flags "$out/share/nbt-web/server.py" \
                --set NBT_WEB_STATIC "$out/share/nbt-web/static"
            '';
          };
      });

      nixosModules.default = import ./module.nix { inherit self; };

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ (pkgs.python3.withPackages (ps: [ ps.nbtlib ])) ];
        };
      });
    };
}
