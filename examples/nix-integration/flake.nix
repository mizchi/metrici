{
  description = "Example: using flaker in nix develop";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flaker.url = "github:mizchi/flaker";
  };

  outputs =
    { nixpkgs, flaker, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          flaker-native = flaker.packages.${system}.default;
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [
              flaker-native
              pkgs.git
              pkgs.nodejs
              pkgs.pnpm
            ];

            shellHook = ''
              echo "flaker available: $(flaker_native --help 2>&1 | head -1)"
            '';
          };
        }
      );
    };
}
