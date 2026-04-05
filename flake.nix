{
  description = "flaker – Intelligent test selection toolkit";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    moonbit-overlay.url = "github:moonbit-community/moonbit-overlay";
    moon-registry = {
      url = "git+https://mooncakes.io/git/index";
      flake = false;
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      flake = {
        overlays.default = _final: prev: {
          flaker = prev.callPackage ./package.nix {
            moonRegistryIndex = inputs.moon-registry;
          };
        };
      };

      perSystem =
        { system, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ inputs.moonbit-overlay.overlays.default ];
            config.allowBroken = true;
          };

          flaker = pkgs.callPackage ./package.nix {
            moonRegistryIndex = inputs.moon-registry;
          };

          moonHome = pkgs.moonPlatform.bundleWithRegistry {
            cachedRegistry = pkgs.moonPlatform.buildCachedRegistry {
              moonModJson = ./moon.mod.json;
              registryIndexSrc = inputs.moon-registry;
            };
          };
        in
        {
          packages = {
            default = flaker;
            inherit flaker;
          };

          apps = {
            default = {
              type = "app";
              program = "${flaker}/bin/flaker_native";
            };
            flaker = {
              type = "app";
              program = "${flaker}/bin/flaker_native";
            };
          };

          devShells.default = pkgs.mkShellNoCC {
            packages = [
              moonHome
              pkgs.git
              pkgs.just
              pkgs.pnpm
              pkgs.nodejs
              pkgs.duckdb
              pkgs.zlib
            ];
            env.MOON_HOME = "${moonHome}";
          };
        };
    };
}
