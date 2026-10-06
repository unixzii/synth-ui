#!/usr/bin/env bash
# Builds the demo on Vercel, whose build image has Node and pnpm but no Rust:
# installs rustup (rust-toolchain.toml then picks the toolchain and the wasm
# target) and the prebuilt wasm-bindgen-cli that matches Cargo.toml.

set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$PATH"

# Build scripts and proc macros link for the host, which needs a C linker.
if ! command -v cc >/dev/null; then
  dnf install -y gcc
fi

if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi

version=$(sed -nE 's/^wasm-bindgen[[:space:]]*=[[:space:]]*"=([^"]+)".*/\1/p' Cargo.toml)
if [ "$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" != "$version" ]; then
  name="wasm-bindgen-$version-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/$name.tar.gz" |
    tar -xz -C "$HOME/.cargo/bin" --strip-components=1 "$name/wasm-bindgen"
fi

pnpm build:demo
