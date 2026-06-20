#!/bin/bash
set -e

echo "=== MetaClean Desktop Environment Setup ==="

# 1. OS check
if [ "$(uname)" != "Darwin" ]; then
  echo "Error: This script is only designed for macOS."
  exit 1
fi

# 2. Check Xcode Command Line Tools
echo "Checking Xcode Command Line Tools..."
if ! xcode-select -p &>/dev/null; then
  echo "Xcode Command Line Tools not found. Installing..."
  xcode-select --install
  echo "Please complete the Xcode Command Line Tools installation and run this script again."
  exit 1
else
  echo "✓ Xcode Command Line Tools are installed."
fi

# 3. Check Homebrew
echo "Checking Homebrew..."
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Please install Homebrew from https://brew.sh/ and run this script again."
  exit 1
else
  echo "✓ Homebrew is installed."
fi

# 4. Check Rust / Cargo
echo "Checking Rust & Cargo..."
if ! command -v cargo &>/dev/null; then
  echo "Rust/Cargo not found in PATH. Checking if installed in home directory..."
  if [ -f "$HOME/.cargo/env" ]; then
    echo "Rust found at $HOME/.cargo/env. Sourcing..."
    source "$HOME/.cargo/env"
  else
    echo "Rust/Cargo not found. Attempting to install via rustup with --no-modify-path..."
    if curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path; then
      source "$HOME/.cargo/env"
    else
      echo "rustup installer failed or had permission issues. Falling back to Homebrew to install Rust..."
      brew install rust
    fi
  fi
fi

if ! command -v cargo &>/dev/null; then
  echo "Error: Failed to set up Rust. Please install it manually from https://rustup.rs/"
  exit 1
else
  echo "✓ Rust/Cargo configured: $(cargo --version)"
fi

# 5. Check pnpm
echo "Checking pnpm..."
if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found. Installing via npm..."
  npm install -g pnpm
else
  echo "✓ pnpm is installed: $(pnpm --version)"
fi

echo "=== Setup complete! Your system is ready to compile the macOS Desktop App. ==="
echo "Please run: source \$HOME/.cargo/env"
