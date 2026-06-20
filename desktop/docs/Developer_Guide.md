# MetaClean macOS Desktop Developer Guide

Welcome to the MetaClean macOS Desktop Developer Guide. This guide contains everything you need to know about setting up, developing, building, signing, and distributing MetaClean as a native macOS application.

---

## 1. Prerequisites & Environment Setup

MetaClean is built on the **Tauri v2** framework, wrapping the React Vite application with a native Rust core. 

To build the desktop application, your macOS development machine requires:
1. **Xcode Command Line Tools** (for compiler tools like `clang` and `codesign`)
2. **Homebrew** (macOS package manager)
3. **Rust Compiler & Cargo** (minimum version 1.77.2)
4. **NodeJS & pnpm**

We provide an automated setup script that configures these requirements. Run the following command from the workspace root:

```bash
# 1. Run the environment bootstrap script
./desktop/scripts/setup_env.sh

# 2. Source the newly configured Cargo environment variables
source $HOME/.cargo/env
```

---

## 2. Directory Structure

The desktop workspace is located inside the `/desktop` directory:

```
desktop/
├── src/           # Frontend React + Vite codebase
├── desktop/       # Tauri desktop configuration and Rust wrapper
│   ├── src/       # Rust native commands (Keychain, File IO) & main loop
│   ├── Cargo.toml # Rust compiler dependencies (keyring, tauri)
│   └── tauri.conf.json # Desktop app configuration (CSP, plugins, permissions)
├── build/         # Production-ready macOS APP bundle output
├── dmg/           # Final generated .DMG installer output
├── scripts/       # Automation pipelines (build.sh, sign_notarize.sh, setup_env.sh)
└── docs/          # Guides and documentation
```

---

## 3. Development Workflow

To launch the application in development mode with hot-reloading and Web Inspector support:

```bash
# Navigate to the desktop directory
cd desktop

# Launch the Tauri dev environment
pnpm desktop:dev
```

This command runs Vite on `http://localhost:1420` and loads it into a custom native WKWebView window with developer console tools enabled (access them by right-clicking the window and selecting **Inspect Element**).

---

## 4. Production Build

To build a production-ready application bundle locally (without official Apple Developer ID signing):

```bash
# From the workspace root, execute the automated build script:
./desktop/scripts/build.sh
```

This compiles Vite, bundles your static assets (including FFmpeg WebAssembly resources), compiles the Rust backend in release mode, and bundles them into:
- A `.app` bundle under `desktop/build/`
- A `.dmg` installer under `desktop/dmg/`

---

## 5. Apple Code Signing & Notarization

To distribute MetaClean to external users without macOS gatekeeper alerts ("App is damaged", "Cannot be opened because the developer cannot be verified"), you must sign and notarize the app.

### A. Prerequisites
1. An active Apple Developer Account.
2. A **Developer ID Application** Certificate (install in your macOS Keychain).
3. An App-Specific Password generated from your Apple account (appleid.apple.com) for notarization submissions.

### B. Configuring Environment Variables
Create a file named `.env` in `desktop/` and specify your Apple Developer coordinates:

```env
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name/Company (TEAMID)"
APPLE_ID="developer-email@apple.com"
APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # App-specific password
APPLE_TEAM_ID="10CHARTEAMID"
```

### C. Running the Release Pipeline
Execute the signing and notarization pipeline script:

```bash
./desktop/scripts/sign_notarize.sh
```

The script will:
1. Sign the `MetaClean.app` binary with standard hardened runtime capabilities (`--options runtime`).
2. Rebundle it into a DMG.
3. Submit the DMG to Apple Notary Service.
4. Block and poll until notarization completes.
5. Staple the notarization ticket to the DMG so it can run offline.

---

## 6. Secure macOS Keychain Integration

MetaClean has native Rust integration with the **macOS Keychain** using the `keyring` crate. 

Three native commands are exposed to the frontend:
- `save_secret(service: String, username: String, secret: String)`
- `get_secret(service: String, username: String)`
- `delete_secret(service: String, username: String)`

### Frontend Usage
Import the bridge in your components:

```typescript
import { saveSecretKeychain, getSecretKeychain } from "@/lib/tauri-bridge";

// Save a token
await saveSecretKeychain("MetaClean", "user_session", "secret_token_value");

// Retrieve the token
const token = await getSecretKeychain("MetaClean", "user_session");
```

---

## 7. Troubleshooting & Performance Tips

### A. WebAssembly "Memory Access Out Of Bounds"
FFmpeg WASM does not shrink its heap between encodes, causing memory exhaustion during large batch processes. 
- **Solution**: The frontend hook `use-metaclean.ts` monitors processed bytes and automatically recycles the WASM instance once it exceeds a 60MB budget (`resetFFmpeg`). This is fully automated.

### B. Custom Protocol CORS / CSP Errors
If you add third-party fonts, styles, or API domains, Tauri's Content Security Policy will block them by default.
- **Solution**: Update the `csp` field under the `security` section in `desktop/desktop/tauri.conf.json` to allow the required domain (e.g. `connect-src 'self' ipc: https://api.yourdomain.com`).

### C. Gatekeeper Alert in Local Build
If you build a local `.app` or `.dmg` without signing, macOS will block execution.
- **Solution**: Bypass this locally by running: `xattr -cr /path/to/MetaClean.app` to strip the quarantine flag.
