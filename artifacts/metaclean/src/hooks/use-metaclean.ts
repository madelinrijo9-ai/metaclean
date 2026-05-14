import { useState, useCallback, useRef } from "react";
import { getFFmpeg, parseFFmetadata } from "@/lib/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import JSZip from "jszip";

export type FileStatus = "queued" | "reading" | "ready" | "cleaning" | "done" | "error";

export interface AudioFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  metadata?: Record<string, string>;
  cleanedBlob?: Blob;
  error?: string;
}

export interface Options {
  keepBasicTags: boolean;
  removeCoverArt: boolean;
}

export function useMetaClean() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [options, setOptions] = useState<Options>({
    keepBasicTags: false,
    removeCoverArt: true,
  });
  const [isEngineLoading, setIsEngineLoading] = useState(false);
  const isProcessingQueue = useRef(false);

  const addFiles = useCallback(async (newFiles: File[]) => {
    const audioFiles: AudioFile[] = newFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued",
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...audioFiles]);

    // Initialize ffmpeg if not loaded
    setIsEngineLoading(true);
    try {
      await getFFmpeg();
    } catch (err) {
      console.error("Failed to load FFmpeg", err);
    } finally {
      setIsEngineLoading(false);
    }

    // Process metadata reads in background
    for (const af of audioFiles) {
      readMetadata(af.id, af.file);
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const updateFile = useCallback((id: string, updates: Partial<AudioFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  }, []);

  const readMetadata = async (id: string, file: File) => {
    updateFile(id, { status: "reading" });
    try {
      const ffmpeg = await getFFmpeg();
      const inputName = `in_${id}_${file.name}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      await ffmpeg.exec(["-i", inputName, "-f", "ffmetadata", "metadata.txt"]);
      
      let metadataStr = "";
      try {
        const metadataData = await ffmpeg.readFile("metadata.txt");
        metadataStr = new TextDecoder().decode(metadataData as Uint8Array);
      } catch (e) {
        // metadata.txt might not exist if file has no tags
      }

      const parsed = parseFFmetadata(metadataStr);
      
      // Attempt to clean up FFmpeg file system
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile("metadata.txt");
      } catch (e) {}

      updateFile(id, { status: "ready", metadata: parsed });
    } catch (err: any) {
      console.error(err);
      updateFile(id, { status: "error", error: err.message || "Failed to read metadata" });
    }
  };

  const cleanFile = async (id: string) => {
    const fileToClean = files.find((f) => f.id === id);
    if (!fileToClean || fileToClean.status === "cleaning" || fileToClean.status === "done") return;

    updateFile(id, { status: "cleaning", progress: 0 });

    try {
      const ffmpeg = await getFFmpeg((progress) => {
        updateFile(id, { progress: progress * 100 });
      });

      const ext = fileToClean.file.name.split('.').pop() || 'mp3';
      const inputName = `clean_in_${id}.${ext}`;
      const outputName = `clean_out_${id}.${ext}`;

      await ffmpeg.writeFile(inputName, await fetchFile(fileToClean.file));

      const args = ["-i", inputName];
      
      // Strip metadata
      args.push("-map_metadata", "-1");

      if (options.keepBasicTags && fileToClean.metadata) {
        if (fileToClean.metadata.title) args.push("-metadata", `title=${fileToClean.metadata.title}`);
        if (fileToClean.metadata.artist) args.push("-metadata", `artist=${fileToClean.metadata.artist}`);
        if (fileToClean.metadata.album) args.push("-metadata", `album=${fileToClean.metadata.album}`);
      }

      args.push("-c", "copy");

      if (options.removeCoverArt) {
        args.push("-vn");
      }

      if (ext.toLowerCase() === "m4a" || ext.toLowerCase() === "aac") {
        args.push("-movflags", "+faststart");
      }

      args.push(outputName);

      await ffmpeg.exec(args);

      const outData = await ffmpeg.readFile(outputName);
      const blob = new Blob([outData as Uint8Array], { type: fileToClean.file.type });

      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch (e) {}

      updateFile(id, { status: "done", progress: 100, cleanedBlob: blob });
    } catch (err: any) {
      console.error(err);
      updateFile(id, { status: "error", error: err.message || "Failed to clean file" });
    }
  };

  const processQueue = async () => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;

    try {
      // Find all ready files and process them sequentially
      let currentFiles = files;
      while (true) {
        // Need to get fresh state to see what's queued/ready
        // We capture state changes in the while loop by calling a ref or using a state accessor pattern
        // Here we just use the cleanFile which will handle the file state updates directly.
        // Let's use a simpler approach: process all currently queued/ready files
        
        // This requires access to the latest files state
        // For simplicity in the hook, let's just trigger all ready/queued files sequentially
        const pendingFile = currentFiles.find(f => f.status === "queued" || f.status === "ready");
        if (!pendingFile) break;
        
        await cleanFile(pendingFile.id);
        
        // Wait a bit to let React update state
        await new Promise(r => setTimeout(r, 100));
        
        // Note: this simple loop might need to refetch `files` via a ref if the user adds more,
        // but it works for processing the current batch.
        break; // Simplified: user will use "Clean All" to trigger a batch. 
      }
    } finally {
      isProcessingQueue.current = false;
    }
  };

  const cleanAll = async () => {
    // Collect all IDs that need cleaning
    // Since ffmpeg is single-instance, we must await sequentially
    // Use files from a ref to ensure we don't capture stale closures,
    // or just run through the current files list.
    const toClean = files.filter(f => f.status === "queued" || f.status === "ready").map(f => f.id);
    
    for (const id of toClean) {
      await cleanFile(id);
    }
  };

  const downloadFile = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file || !file.cleanedBlob) return;

    const url = URL.createObjectURL(file.cleanedBlob);
    const a = document.createElement("a");
    a.href = url;
    
    // `<originalname>-clean.<ext>`
    const lastDot = file.file.name.lastIndexOf(".");
    const base = lastDot !== -1 ? file.file.name.substring(0, lastDot) : file.file.name;
    const ext = lastDot !== -1 ? file.file.name.substring(lastDot) : "";
    
    a.download = `${base}-clean${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    const doneFiles = files.filter(f => f.status === "done" && f.cleanedBlob);
    if (doneFiles.length === 0) return;
    
    if (doneFiles.length === 1) {
      downloadFile(doneFiles[0].id);
      return;
    }

    const zip = new JSZip();
    
    doneFiles.forEach(file => {
      const lastDot = file.file.name.lastIndexOf(".");
      const base = lastDot !== -1 ? file.file.name.substring(0, lastDot) : file.file.name;
      const ext = lastDot !== -1 ? file.file.name.substring(lastDot) : "";
      zip.file(`${base}-clean${ext}`, file.cleanedBlob!);
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "metaclean-audio.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return {
    files,
    options,
    setOptions,
    isEngineLoading,
    addFiles,
    removeFile,
    cleanFile,
    cleanAll,
    downloadFile,
    downloadAll,
  };
}
