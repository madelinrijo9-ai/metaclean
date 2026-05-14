import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let loadPromise: Promise<void> | null = null;

export const getFFmpeg = async (onProgress?: (progress: number) => void): Promise<FFmpeg> => {
  if (ffmpeg && isLoaded) {
    return ffmpeg;
  }

  if (loadPromise) {
    await loadPromise;
    return ffmpeg!;
  }

  ffmpeg = new FFmpeg();
  
  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(progress);
    });
  }

  loadPromise = (async () => {
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await ffmpeg!.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    isLoaded = true;
  })();

  await loadPromise;
  return ffmpeg!;
};

export const parseFFmetadata = (content: string): Record<string, string> => {
  const lines = content.split('\n');
  const metadata: Record<string, string> = {};
  
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    // Skip empty lines and comments (except in multiline values)
    if (!line.trim() || line.startsWith(';')) {
        continue;
    }
    
    // Check if line matches "key=value" pattern
    const match = line.match(/^([^=]+)=(.*)$/);
    
    if (match) {
        // Save previous key-value pair if exists
        if (currentKey) {
            metadata[currentKey] = currentValue.trim();
        }
        
        currentKey = match[1].toLowerCase();
        currentValue = match[2];
    } else if (currentKey) {
        // Handle multiline values (very rare in audio tags but possible)
        currentValue += '\n' + line;
    }
  }

  // Save the last key-value pair
  if (currentKey) {
      metadata[currentKey] = currentValue.trim();
  }

  return metadata;
};
