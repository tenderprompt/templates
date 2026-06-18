#!/usr/bin/env bash
set -euo pipefail

TOOLCHAIN_DIR="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin"

export RUSTC="${TOOLCHAIN_DIR}/rustc"
"${TOOLCHAIN_DIR}/cargo" build --target=wasm32-unknown-unknown --release
