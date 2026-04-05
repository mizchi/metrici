# flaker Nix Integration Example

## Quick Start

```bash
# Enter dev shell with flaker available
nix develop

# Or with direnv
direnv allow
```

## Usage

### 1. Initialize

Edit `flaker.toml` with your repo info:

```toml
[repo]
owner = "your-org"
name = "your-repo"
```

### 2. Collect CI data

```bash
export GITHUB_TOKEN="ghp_..."
flaker_native collect
```

### 3. Analyze

```bash
# Project calibration
flaker_native calibrate

# Flaky test rankings
flaker_native flaky --top 10

# Sample tests for selective execution
flaker_native sample --strategy hybrid --percentage 30
```

## Using as overlay

```nix
{
  inputs.flaker.url = "github:mizchi/flaker";

  outputs = { nixpkgs, flaker, ... }: {
    # Add flaker to your existing devShell
    devShells.default = pkgs.mkShellNoCC {
      packages = [ flaker.packages.${system}.default ];
    };

    # Or use the overlay
    nixpkgs.overlays = [ flaker.overlays.default ];
    # Then: pkgs.flaker is available
  };
}
```
