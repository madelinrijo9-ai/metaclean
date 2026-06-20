import { invoke } from "@tauri-apps/api/core";

/**
 * Checks if the application is running inside the Tauri desktop wrapper.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Saves a file natively using a native macOS save dialog and direct Rust file write.
 */
export async function saveFileNative(fileName: string, blob: Blob): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    
    // 1. Open the native macOS save dialog
    const selectedPath = await save({
      defaultPath: fileName,
      filters: [
        {
          name: "Audio Files",
          extensions: ["mp3", "wav", "flac", "m4a", "ogg", "opus"],
        },
      ],
    });

    if (!selectedPath) {
      // User cancelled the dialog
      return false;
    }

    // 2. Convert Blob to ArrayBuffer and then to a Uint8Array
    const buffer = await blob.arrayBuffer();
    const dataArray = new Uint8Array(buffer);
    const base64Data = uint8ToBase64(dataArray);

    // 3. Call our custom Rust command to save the file
    await invoke("save_file_native", {
      path: selectedPath,
      data: base64Data,
    });

    return true;
  } catch (error) {
    console.error("Failed to save file natively:", error);
    throw error;
  }
}

/**
 * Sends a native macOS user notification.
 */
export async function showNotification(title: string, body: string): Promise<void> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        "@tauri-apps/plugin-notification"
      );
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === "granted";
      }
      if (permissionGranted) {
        sendNotification({ title, body });
        return;
      }
    } catch (e) {
      console.warn("Failed to send native notification, falling back to browser Notification", e);
    }
  }

  // Fallback to Web Notification API
  if (typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification(title, { body });
      }
    }
  }
}

/**
 * Copies text to the native clipboard.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (isTauri()) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    } catch (e) {
      console.warn("Failed to write to native clipboard, falling back to navigator", e);
    }
  }

  // Fallback to browser clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    throw new Error("Clipboard API not available");
  }
}

// ────────────────────────────────────────────────────────────────
// Secure Keychain Storage Integration
// ────────────────────────────────────────────────────────────────

export async function saveSecretKeychain(
  service: string,
  username: string,
  secret: string
): Promise<void> {
  if (isTauri()) {
    await invoke("save_secret", { service, username, secret });
  } else {
    // Web fallback (fallback to localStorage, or mock)
    localStorage.setItem(`secret:${service}:${username}`, secret);
  }
}

export async function getSecretKeychain(
  service: string,
  username: string
): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string>("get_secret", { service, username });
    } catch (e) {
      console.warn("Keychain get failed:", e);
      return null;
    }
  } else {
    return localStorage.getItem(`secret:${service}:${username}`);
  }
}

export async function deleteSecretKeychain(
  service: string,
  username: string
): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("delete_secret", { service, username });
    } catch (e) {
      console.warn("Keychain delete failed:", e);
    }
  } else {
    localStorage.removeItem(`secret:${service}:${username}`);
  }
}

/**
 * Saves a cleaned song natively into the user's Downloads directory structured by Artist and Album.
 * Returns the absolute path where the file was saved.
 */
export async function saveCleanedSongNative(
  fileName: string,
  artist: string | undefined,
  album: string | undefined,
  blob: Blob
): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    const buffer = await blob.arrayBuffer();
    const dataArray = new Uint8Array(buffer);
    const base64Data = uint8ToBase64(dataArray);

    const savedPath = await invoke<string>("save_cleaned_song", {
      filename: fileName,
      artist: artist || null,
      album: album || null,
      data: base64Data,
    });

    return savedPath;
  } catch (error) {
    console.error("Failed to save cleaned song natively:", error);
    throw error;
  }
}

/**
 * Opens a file in Finder (selects the file in the Finder window).
 */
export async function openInFinderNative(filePath: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("open_in_finder", { path: filePath });
  } catch (error) {
    console.error("Failed to open file in Finder:", error);
  }
}

/**
 * Converts a Uint8Array binary buffer to a Base64 string in chunks to prevent call-stack size limits.
 */
function uint8ToBase64(uint8: Uint8Array): string {
  let binary = "";
  const len = uint8.byteLength;
  const chunk = 0x8000; // 32KB chunks
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      uint8.subarray(i, Math.min(i + chunk, len)) as any
    );
  }
  return btoa(binary);
}
