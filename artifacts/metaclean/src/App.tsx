import {
  Upload,
  FileAudio,
  ShieldCheck,
  Download,
  Trash2,
  CheckCircle2,
  CircleSlash,
  RefreshCw,
  Moon,
  Sun,
  AlertCircle,
  Sparkles,
  Music2,
  Clock3,
  Gauge,
  Eraser,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { formatBytes } from "@/lib/utils";
import { useMetaClean, AudioFile, CustomMetadata } from "@/hooks/use-metaclean";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { MetadataEditor } from "@/components/metadata-editor";
import { FORMATS, type OutputFormat } from "@/lib/ffmpeg";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BASIC_TAGS = ["title", "artist", "album", "album_artist"];
const AI_HINT_KEYS = new Set([
  "encoder", "encoded_by", "encoder_settings", "tool", "software",
  "comment", "description", "tsse", "tenc", "tssw",
  "generator", "prompt", "model", "suno", "udio",
]);

function isAiTag(key: string): boolean {
  const k = key.toLowerCase();
  if (AI_HINT_KEYS.has(k)) return true;
  return /suno|udio|generator|prompt|^ai|model/.test(k);
}

function formatDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      title="Toggle theme"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

function DropZone({
  onDrop,
  hasFiles,
}: {
  onDrop: (files: File[]) => void;
  hasFiles: boolean;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "audio/mpeg": [".mp3"],
      "audio/wav": [".wav"],
      "audio/flac": [".flac"],
      "audio/mp4": [".m4a"],
      "audio/aac": [".aac"],
      "audio/ogg": [".ogg", ".opus"],
      "audio/x-ms-wma": [".wma"],
    },
  });

  return (
    <div
      {...getRootProps()}
      className={`relative w-full rounded-xl border-2 border-dashed transition-all duration-200 ease-in-out cursor-pointer group ${
        hasFiles ? "p-6" : "p-12"
      } ${
        isDragActive
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/50 hover:bg-accent/40"
      }`}
    >
      <input {...getInputProps()} />
      <div
        className={`flex ${
          hasFiles ? "flex-row items-center justify-center gap-4" : "flex-col items-center justify-center space-y-4"
        } text-center`}
      >
        <div
          className={`p-3 rounded-full transition-colors duration-200 ${
            isDragActive
              ? "bg-primary text-primary-foreground"
              : "bg-accent text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
          }`}
        >
          <Upload className={hasFiles ? "w-5 h-5" : "w-8 h-8"} />
        </div>
        <div className={hasFiles ? "text-left" : "space-y-2"}>
          <h3
            className={`font-semibold tracking-tight ${
              hasFiles ? "text-base" : "text-xl"
            }`}
          >
            {hasFiles ? "Add more audio files" : "Drop audio files here"}
          </h3>
          {!hasFiles && (
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Drag and drop or click to select. MP3, WAV, FLAC, M4A, AAC, OGG, OPUS, WMA.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: AudioFile["status"] }) {
  const map: Record<AudioFile["status"], { label: string; cls: string }> = {
    queued: { label: "Queued", cls: "bg-muted text-muted-foreground" },
    reading: { label: "Reading…", cls: "bg-muted text-muted-foreground" },
    ready: { label: "Ready", cls: "bg-primary/10 text-primary" },
    cleaning: { label: "Cleaning…", cls: "bg-primary/10 text-primary" },
    done: { label: "Cleaned", cls: "bg-emerald-500/10 text-emerald-500" },
    error: { label: "Error", cls: "bg-destructive/10 text-destructive" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

function FileRow({
  file,
  totalFiles,
  onRemove,
  onClean,
  onDownload,
  options,
  onCustomChange,
  onCoverArt,
  onClearCoverArt,
  onApplyToAll,
  onSetFormat,
  onSetBitrate,
}: {
  file: AudioFile;
  totalFiles: number;
  onRemove: (id: string) => void;
  onClean: (id: string) => void;
  onDownload: (id: string) => void;
  options: { keepBasicTags: boolean; removeCoverArt: boolean };
  onCustomChange: (id: string, patch: Partial<CustomMetadata>) => void;
  onCoverArt: (id: string, file: File) => void;
  onClearCoverArt: (id: string) => void;
  onApplyToAll: (id: string) => void;
  onSetFormat: (id: string, fmt: OutputFormat) => void;
  onSetBitrate: (id: string, br: number | undefined) => void;
}) {
  const isDone = file.status === "done";
  const isCleaning = file.status === "cleaning";
  const isReading = file.status === "reading";
  const isError = file.status === "error";
  const tagEntries = file.metadata ? Object.entries(file.metadata) : [];
  const hasMetadata = tagEntries.length > 0;
  const aiTags = tagEntries.filter(([k]) => isAiTag(k));
  const customs = file.customMetadata
    ? Object.entries(file.customMetadata).filter(([, v]) => v && String(v).trim() !== "")
    : [];

  const info = file.audioInfo;
  const inputExt = (file.file.name.split(".").pop() || "").toLowerCase();
  const targetExt =
    file.outputFormat === "same" ? inputExt : FORMATS[file.outputFormat].ext;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="group flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <div
            className={`flex items-center justify-center w-11 h-11 rounded-md shrink-0 ${
              isDone
                ? "bg-emerald-500/10 text-emerald-500"
                : isError
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
            }`}
          >
            {isDone ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : isError ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <FileAudio className="w-5 h-5" />
            )}
          </div>

          <div className="flex flex-col min-w-0 gap-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate" title={file.file.name}>
                {file.file.name}
              </span>
              <StatusPill status={file.status} />
              {aiTags.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                  title={`AI fingerprints found: ${aiTags.map(([k]) => k).join(", ")}`}
                >
                  <Sparkles className="w-3 h-3" />
                  AI tags found
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Music2 className="w-3 h-3" />
                {(info?.codec || inputExt).toUpperCase()}
                {file.outputFormat !== "same" && (
                  <span className="text-foreground/70">→ {targetExt.toUpperCase()}</span>
                )}
              </span>
              <span>{formatBytes(file.file.size)}</span>
              {info?.durationSec != null && (
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="w-3 h-3" />
                  {formatDuration(info.durationSec)}
                </span>
              )}
              {info?.bitrateKbps != null && (
                <span className="inline-flex items-center gap-1">
                  <Gauge className="w-3 h-3" />
                  {info.bitrateKbps} kbps
                </span>
              )}
              {info?.sampleRate != null && (
                <span>{(info.sampleRate / 1000).toFixed(1)} kHz</span>
              )}
              {info?.channels != null && (
                <span>{info.channels === 1 ? "Mono" : info.channels === 2 ? "Stereo" : `${info.channels}ch`}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isDone && !isCleaning && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onClean(file.id)}
              disabled={isReading}
            >
              {isError ? "Retry" : "Clean"}
            </Button>
          )}

          {isDone && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onDownload(file.id)}
            >
              <Download className="w-4 h-4 mr-2" /> Download
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(file.id)}
            title="Remove from queue"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {(isCleaning || isReading) && (
        <Progress
          value={isReading ? undefined : file.progress}
          className="h-1.5"
        />
      )}

      {!isError && !isReading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-md bg-accent/30 p-3 text-sm">
          <div className="space-y-2">
            <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
              Original tags
            </div>
            {hasMetadata ? (
              <div className="flex flex-wrap gap-1.5">
                {tagEntries.slice(0, 18).map(([key, value]) => {
                  const ai = isAiTag(key);
                  return (
                    <Badge
                      key={key}
                      variant={ai ? "default" : "secondary"}
                      className={
                        ai
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 border-amber-500/20"
                          : ""
                      }
                      title={`${key}: ${value}`}
                    >
                      <span className="font-semibold">{key}</span>
                      <span className="max-w-[140px] truncate ml-1 opacity-80">
                        {value}
                      </span>
                    </Badge>
                  );
                })}
                {tagEntries.length > 18 && (
                  <Badge variant="outline">+{tagEntries.length - 18} more</Badge>
                )}
              </div>
            ) : (
              <div className="text-muted-foreground italic flex items-center gap-1.5">
                <CircleSlash className="w-3 h-3" /> No metadata found
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
              After cleaning
            </div>
            <div className="flex flex-wrap gap-1.5">
              {customs.length > 0 ? (
                customs.map(([k, v]) => (
                  <Badge
                    key={k}
                    variant="default"
                    className="bg-primary/15 text-primary hover:bg-primary/25 border-primary/20"
                  >
                    <span className="font-semibold">{k}</span>
                    <span className="max-w-[140px] truncate ml-1 opacity-80">
                      {v}
                    </span>
                  </Badge>
                ))
              ) : options.keepBasicTags && file.metadata && BASIC_TAGS.some((t) => file.metadata![t]) ? (
                BASIC_TAGS.map((tag) =>
                  file.metadata![tag] ? (
                    <Badge key={tag} variant="secondary">
                      <span className="font-semibold">{tag}</span>
                      <span className="max-w-[140px] truncate ml-1 opacity-80">
                        {file.metadata![tag]}
                      </span>
                    </Badge>
                  ) : null
                )
              ) : (
                <div className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> All metadata stripped
                </div>
              )}
              {file.coverArt ? (
                <Badge variant="outline" className="border-primary/30 text-primary">
                  Custom cover
                </Badge>
              ) : options.removeCoverArt ? (
                <Badge variant="outline" className="text-muted-foreground">
                  No cover art
                </Badge>
              ) : (
                file.originalCoverDataUrl && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Original cover kept
                  </Badge>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {isError && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{file.error}</span>
        </div>
      )}

      {!isError && !isReading && (
        <MetadataEditor
          file={file}
          totalFiles={totalFiles}
          onChange={onCustomChange}
          onCoverArt={onCoverArt}
          onClearCoverArt={onClearCoverArt}
          onApplyToAll={onApplyToAll}
          onSetFormat={onSetFormat}
          onSetBitrate={onSetBitrate}
        />
      )}
    </motion.div>
  );
}

function MainApp() {
  const {
    files,
    options,
    setOptions,
    isEngineLoading,
    isEngineReady,
    addFiles,
    removeFile,
    clearAll,
    cleanFile,
    cleanAll,
    downloadFile,
    downloadAll,
    setCustomMetadata,
    setCoverArt,
    clearCoverArt,
    applyToAll,
    setOutputFormat,
    setOutputBitrate,
    setOutputFormatAll,
  } = useMetaClean();

  const canCleanAll = files.some(
    (f) => f.status === "ready" || f.status === "queued" || f.status === "error"
  );
  const doneCount = files.filter((f) => f.status === "done").length;
  const canDownloadAll = doneCount > 1;
  const isAnyCleaning = files.some((f) => f.status === "cleaning");
  const aiFingerprintCount = files.reduce((acc, f) => {
    const tags = f.metadata ? Object.keys(f.metadata) : [];
    return acc + tags.filter(isAiTag).length;
  }, 0);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto max-w-6xl h-16 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-lg tracking-tight">MetaClean</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground hidden sm:inline">
                Strip & retag audio
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase items-center gap-1.5 hidden md:inline-flex">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Files never leave your browser
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <DropZone onDrop={addFiles} hasFiles={files.length > 0} />
            <AnimatePresence>
              {isEngineLoading && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-center p-3 text-sm text-muted-foreground bg-accent/50 rounded-lg"
                >
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin text-primary" />
                  Loading audio engine (one time, ~30 MB)… You can add files while this finishes.
                </motion.div>
              )}
              {!isEngineLoading && isEngineReady && files.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-center p-2 text-xs text-emerald-600 dark:text-emerald-400"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                  Audio engine ready. Cleaning will start instantly.
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Card className="h-fit">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">Processing options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Default output format
                </label>
                <Select
                  value={options.defaultOutputFormat}
                  onValueChange={(v) => setOutputFormatAll(v as OutputFormat)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same">Same as input</SelectItem>
                    {(Object.keys(FORMATS) as Array<keyof typeof FORMATS>).map((k) => (
                      <SelectItem key={k} value={k}>
                        {FORMATS[k].label} — {FORMATS[k].description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Applies to every file. You can override per-file in its editor.
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="keep-basic"
                    checked={options.keepBasicTags}
                    onCheckedChange={(c) =>
                      setOptions((prev) => ({ ...prev, keepBasicTags: !!c }))
                    }
                  />
                  <div className="space-y-0.5 leading-none">
                    <label
                      htmlFor="keep-basic"
                      className="text-sm font-medium cursor-pointer"
                    >
                      Keep basic tags
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Preserve title, artist, and album from the original.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="remove-art"
                    checked={options.removeCoverArt}
                    onCheckedChange={(c) =>
                      setOptions((prev) => ({ ...prev, removeCoverArt: !!c }))
                    }
                  />
                  <div className="space-y-0.5 leading-none">
                    <label
                      htmlFor="remove-art"
                      className="text-sm font-medium cursor-pointer"
                    >
                      Remove embedded cover art
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Off keeps the original cover when possible.
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!canCleanAll || isAnyCleaning}
                  onClick={cleanAll}
                >
                  {isAnyCleaning ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      {isEngineReady ? "Cleaning…" : "Loading engine…"}
                    </>
                  ) : (
                    `Clean ${files.filter((f) => f.status !== "done" && f.status !== "cleaning").length || ""} file${files.length === 1 ? "" : "s"}`.trim()
                  )}
                </Button>
                {isAnyCleaning && !isEngineReady && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    First-time setup downloads ~30 MB. Subsequent cleans are instant.
                  </p>
                )}

                <AnimatePresence>
                  {canDownloadAll && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={downloadAll}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download all ({doneCount}) as .zip
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {files.length > 0 && (
                  <Button
                    variant="ghost"
                    className="w-full text-muted-foreground"
                    onClick={clearAll}
                    disabled={isAnyCleaning}
                  >
                    <Eraser className="w-4 h-4 mr-2" />
                    Clear queue
                  </Button>
                )}
              </div>

              {aiFingerprintCount > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    {aiFingerprintCount} AI fingerprint{aiFingerprintCount === 1 ? "" : "s"} detected
                  </div>
                  <p className="opacity-80">
                    Generator tags from tools like Suno or Udio were spotted across your files. Cleaning will remove them.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                Queue
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {doneCount} of {files.length} cleaned
                </span>
              </h2>
            </div>

            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    totalFiles={files.length}
                    onRemove={removeFile}
                    onClean={cleanFile}
                    onDownload={downloadFile}
                    options={options}
                    onCustomChange={setCustomMetadata}
                    onCoverArt={setCoverArt}
                    onClearCoverArt={clearCoverArt}
                    onApplyToAll={applyToAll}
                    onSetFormat={setOutputFormat}
                    onSetBitrate={setOutputBitrate}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t mt-8">
        <div className="container mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground flex items-center justify-between">
          <span>MetaClean — 100% client-side audio scrubbing.</span>
          <span className="hidden sm:inline">Powered by ffmpeg.wasm + music-metadata.</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="metaclean-theme">
      <TooltipProvider>
        <MainApp />
      </TooltipProvider>
    </ThemeProvider>
  );
}
