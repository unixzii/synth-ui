#!/usr/bin/env bash
# Builds the demo on Vercel, whose build image has Node and pnpm: installs
# rustup unless it's there already (rust-toolchain.toml then picks the
# toolchain and the wasm target), and the prebuilt wasm-bindgen-cli that
# matches Cargo.toml.

set -euo pipefail
cd "$(dirname "$0")/.."

# Where wasm-bindgen goes: rustup may live anywhere, so not next to cargo.
tools="$HOME/.local/bin"
mkdir -p "$tools"
export PATH="$tools:$HOME/.cargo/bin:$PATH"

# Build scripts and proc macros link for the host, which needs a C linker.
if ! command -v cc >/dev/null; then
  dnf install -y gcc
fi

if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
# A toolchain that was installed already doesn't get rust-toolchain.toml's targets.
rustup target add wasm32-unknown-unknown

version=$(sed -nE 's/^wasm-bindgen[[:space:]]*=[[:space:]]*"=([^"]+)".*/\1/p' Cargo.toml)
if [ "$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" != "$version" ]; then
  name="wasm-bindgen-$version-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/$name.tar.gz" |
    tar -xz -C "$tools" --strip-components=1 "$name/wasm-bindgen"
fi
echo "rustup: $(command -v rustup); cargo: $(cargo --version); $(wasm-bindgen --version)"

pnpm build:demo
