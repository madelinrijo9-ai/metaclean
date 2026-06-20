#!/bin/bash
set -e

# macOS Code Signing & Apple Notarization Pipeline Script
# This script signs the compiled .app bundle and notarizes the generated .dmg installer.

echo "=== macOS Signing & Notarization Pipeline ==="

# Load environment variables from .env if present
if [ -f "../.env" ]; then
  echo "Loading environment variables from root .env..."
  export $(grep -v '^#' ../.env | xargs)
elif [ -f ".env" ]; then
  echo "Loading environment variables from local .env..."
  export $(grep -v '^#' .env | xargs)
fi

# Required Environment Variables check
if [ -z "$APPLE_SIGNING_IDENTITY" ] || [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
  echo "Warning: Missing Apple Developer environment variables."
  echo "To fully sign and notarize the app, please set the following variables in a .env file:"
  echo "  APPLE_SIGNING_IDENTITY  - e.g., 'Developer ID Application: Your Company (TEAMID)'"
  echo "  APPLE_ID               - Your Apple ID email address"
  echo "  APPLE_ID_PASSWORD      - App-specific password generated from appleid.apple.com"
  echo "  APPLE_TEAM_ID          - Your Apple Developer Portal 10-character Team ID"
  echo ""
  echo "Proceeding with self-signing (ad-hoc) for local testing..."
  export APPLE_SIGNING_IDENTITY="-"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_PATH=$(find "$DESKTOP_DIR/build" -name "MetaClean.app" | head -n 1)
DMG_PATH=$(find "$DESKTOP_DIR/dmg" -name "MetaClean*.dmg" | head -n 1)

if [ -z "$APP_PATH" ]; then
  echo "Error: MetaClean.app not found. Please compile the app first using scripts/build.sh."
  exit 1
fi

# 1. Native Code Signing
echo "1. Signing macOS APP bundle..."
if [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then
  echo "Performing ad-hoc code signing..."
  codesign --force --deep --sign - "$APP_PATH"
else
  echo "Signing with Developer ID: $APPLE_SIGNING_IDENTITY..."
  # Sign with hardened runtime option enabled (required for notarization)
  codesign --force --options runtime --deep --sign "$APPLE_SIGNING_IDENTITY" "$APP_PATH"
fi
echo "✓ Code signing complete."

# 2. Re-bundling DMG (if signing was updated)
if [ "$APPLE_SIGNING_IDENTITY" != "-" ] && [ -n "$DMG_PATH" ]; then
  # Note: Tauri build packages the signed app into the DMG. If we sign it after build,
  # we must rebuild the DMG. Alternatively, we configure Tauri to sign during compilation
  # by setting TAURI_SIGNING_IDENTITY and other env vars so that tauri build handles it!
  echo "Note: Re-signing/generating the DMG is recommended using Tauri's built-in signing integrations."
  echo "Run: APPLE_SIGNING_IDENTITY=\"$APPLE_SIGNING_IDENTITY\" pnpm tauri build"
fi

# 3. Notarization Submission
if [ "$APPLE_SIGNING_IDENTITY" != "-" ] && [ -n "$DMG_PATH" ]; then
  echo "2. Submitting DMG to Apple Notary Service..."
  echo "Submitting: $DMG_PATH"
  
  # Submit for notarization using Apple notarytool (Xcode 13+ standard)
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_ID_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
    
  echo "✓ Notarization submission complete."

  # 4. Stapling Notarization Ticket
  echo "3. Stapling notarization ticket to DMG..."
  xcrun stapler staple "$DMG_PATH"
  echo "✓ Notarization ticket successfully stapled to DMG!"
  
  # Verify stapling
  xcrun stapler validate "$DMG_PATH"
else
  echo "Skipping Apple Notarization (required Apple credentials or identity not configured)."
fi

echo "=== Pipeline finished! ==="
