#!/bin/bash
set -e

# MetaClean Desktop Build Pipeline Script
# Compiles frontend assets and runs the Tauri compiler to produce macOS binaries.

echo "=== MetaClean Desktop Production Build ==="

# Get absolute path to the desktop directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$DESKTOP_DIR"

# 1. Clean previous build artifacts
echo "Cleaning up previous build directories..."
rm -rf dist
rm -rf desktop/target

# 2. Make sure FFmpeg WebAssembly core assets are in public directory
echo "Copying FFmpeg WebAssembly resources..."
pnpm run copy-ffmpeg

# 3. Build the frontend
echo "Building frontend static assets with Vite..."
pnpm run build

# 4. Compile the native macOS application (Tauri wrapper)
echo "Building native macOS desktop application..."
# In Tauri v2, the CLI command is 'tauri build'
# If environment variables for signing/notarization are present, Tauri will automatically use them.
pnpm tauri build

# 5. Locate built assets and copy to desktop/build output
echo "Locating build outputs..."
SRC_BUILD_DIR="$DESKTOP_DIR/desktop/target/release/bundle"

# Create output directories if they don't exist
mkdir -p "$DESKTOP_DIR/build"
mkdir -p "$DESKTOP_DIR/dmg"

if [ -d "$SRC_BUILD_DIR" ]; then
  # Copy macOS DMG and APP bundles to desktop output directories
  echo "Copying macOS app and installer to desktop build directory..."
  find "$SRC_BUILD_DIR/dmg" -name "*.dmg" -exec cp -f {} "$DESKTOP_DIR/dmg/" \;
  find "$SRC_BUILD_DIR/macos" -name "*.app" -exec cp -R -f {} "$DESKTOP_DIR/build/" \;
  echo "✓ DMG installer saved at: $DESKTOP_DIR/dmg/"
  echo "✓ Signed APP bundle saved at: $DESKTOP_DIR/build/"
else
  echo "Warning: Tauri target bundle directory not found at $SRC_BUILD_DIR."
fi

echo "=== Build finished successfully! ==="
