# MetaClean - Strip AI Metadata from Audio (Local Version)

MetaClean is an offline, privacy-first web application designed to strip AI metadata and other tracking tags from audio files, while allowing you to add custom tags and cover art.

This package contains the fully functional local version of MetaClean that runs entirely in your web browser, as well as configurations for building native desktop versions.

---

## ⚙️ Automated Desktop Builds (Windows `.exe` & macOS `.dmg`)

We have configured a **GitHub Actions Workflow** that automatically builds and bundles your application into a native Windows `.exe` installer and a macOS `.dmg` installer.

### How to use it:
1. **Push** this repository to your GitHub account.
2. Go to the **Actions** tab in your GitHub repository.
3. You will see the **Release Build** workflow run automatically (or you can trigger it manually using the "Run workflow" button).
4. Once completed, a draft release will be created under **Releases** on your GitHub page containing:
   * 📦 `MetaClean_1.0.0_x64-setup.exe` (Windows Installer)
   * 📦 `MetaClean_1.0.0_x64.dmg` (macOS Installer)
5. Download the `.exe` and install it on your Windows machine!

---

## 🚀 How to Run Locally in Browser (No Compile Required)

Follow these simple steps to run MetaClean directly in your web browser:

### Prerequisites
Make sure you have **Node.js** installed on your computer. If you don't have it, download and install it from [https://nodejs.org/](https://nodejs.org/) (LTS version is recommended).

### Setup & Launch
1. **Unzip** this archive to a folder on your computer.
2. Open your system's **Terminal** (macOS/Linux) or **Command Prompt / PowerShell** (Windows).
3. Navigate (`cd`) to the unzipped folder.
4. Run the startup script:
   - **macOS / Linux**:
     ```bash
     chmod +x start-local.sh
     ./start-local.sh
     ```
   - **Windows**:
     ```bash
     npx pnpm install
     npx pnpm dev
     ```
5. Open your web browser and navigate to:
   👉 **[http://localhost:1420/](http://localhost:1420/)**

---

## 💾 Saving Cleaned Music

* **Choose Where to Save (Chrome / Edge / Opera)**: By default, the application uses the browser's modern File System Access API. Clicking **Download** will open a standard save dialog asking you where to save your cleaned songs or ZIP files on your system.
* **Safari & Firefox Fallback**: In browsers that do not support this dialog API, the files will download automatically to your default `Downloads` folder. If you want to be prompted where to save each file in these browsers, you can toggle the *"Ask where to save each file before downloading"* option in your browser's settings.
