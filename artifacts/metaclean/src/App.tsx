import { useState, useCallback, useRef } from "react";
import { Upload, FileAudio, Settings2, Download, Trash2, CheckCircle2, Play, CircleSlash, RefreshCw, Moon, Sun, AlertCircle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { formatBytes } from "@/lib/utils";
import { useMetaClean, AudioFile, CustomMetadata } from "@/hooks/use-metaclean";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { MetadataEditor } from "@/components/metadata-editor";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

function DropZone({ onDrop }: { onDrop: (files: File[]) => void }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/flac': ['.flac'],
      'audio/mp4': ['.m4a'],
      'audio/aac': ['.aac'],
      'audio/ogg': ['.ogg', '.opus'],
      'audio/x-ms-wma': ['.wma']
    }
  });

  return (
    <div
      {...getRootProps()}
      className={`relative w-full rounded-xl border-2 border-dashed p-12 transition-all duration-200 ease-in-out cursor-pointer group ${
        isDragActive
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-accent/50"
      }`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center justify-center space-y-4 text-center">
        <div className={`p-4 rounded-full transition-colors duration-200 ${
          isDragActive ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
        }`}>
          <Upload className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold tracking-tight">Drop audio files here</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Drag and drop or click to select files. Supports MP3, WAV, FLAC, M4A, AAC, OGG, OPUS, WMA.
          </p>
        </div>
      </div>
    </div>
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
}) {
  const isDone = file.status === "done";
  const isCleaning = file.status === "cleaning";
  const isError = file.status === "error";
  const hasMetadata = file.metadata && Object.keys(file.metadata).length > 0;

  const basicTags = ["title", "artist", "album"];
  const importantAiTags = ["encoder", "comment", "description", "tool", "software"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${
            isDone ? "bg-green-500/10 text-green-500" :
            isError ? "bg-destructive/10 text-destructive" :
            "bg-primary/10 text-primary"
          }`}>
            {isDone ? <CheckCircle2 className="w-5 h-5" /> : 
             isError ? <AlertCircle className="w-5 h-5" /> : 
             <FileAudio className="w-5 h-5" />}
          </div>
          
          <div className="flex flex-col min-w-0">
            <span className="font-medium truncate" title={file.file.name}>{file.file.name}</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatBytes(file.file.size)}</span>
              <span>•</span>
              <span className="capitalize">{file.status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isDone && !isCleaning && (
            <Button variant="outline" size="sm" onClick={() => onClean(file.id)} disabled={file.status === "reading"}>
              Clean
            </Button>
          )}
          
          {isDone && (
            <Button variant="default" size="sm" onClick={() => onDownload(file.id)}>
              <Download className="w-4 h-4 mr-2" /> Download
            </Button>
          )}
          
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(file.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {(isCleaning || file.status === "reading") && (
        <Progress value={file.status === "reading" ? undefined : file.progress} className="h-1.5" />
      )}

      {file.status !== "reading" && !isError && (
        <div className="grid grid-cols-2 gap-4 rounded-md bg-accent/30 p-3 text-sm">
          <div className="space-y-2">
            <div className="font-medium text-xs text-muted-foreground uppercase tracking-wider">Before</div>
            {hasMetadata ? (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(file.metadata!).map(([key, value]) => (
                  <Badge 
                    key={key} 
                    variant={basicTags.includes(key) ? "secondary" : "default"}
                    className={basicTags.includes(key) ? "" : "bg-primary/20 text-primary hover:bg-primary/30 border-primary/20"}
                    title={`${key}: ${value}`}
                  >
                    {key}: <span className="max-w-[100px] truncate ml-1 opacity-80">{value}</span>
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground italic flex items-center gap-1.5">
                <CircleSlash className="w-3 h-3" /> No metadata found
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="font-medium text-xs text-muted-foreground uppercase tracking-wider">After</div>
            <div className="flex flex-wrap gap-1.5">
              {!options.keepBasicTags || !file.metadata || !basicTags.some(t => file.metadata![t]) ? (
                <div className="text-muted-foreground italic flex items-center gap-1.5">
                  <CircleSlash className="w-3 h-3" /> All metadata stripped
                </div>
              ) : (
                basicTags.map(tag => file.metadata![tag] ? (
                  <Badge key={tag} variant="secondary">
                    {tag}: <span className="max-w-[100px] truncate ml-1 opacity-80">{file.metadata![tag]}</span>
                  </Badge>
                ) : null)
              )}
              {options.removeCoverArt && (
                 <Badge variant="outline" className="text-muted-foreground">No Cover Art</Badge>
              )}
            </div>
          </div>
        </div>
      )}
      
      {isError && (
        <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-md">
          {file.error}
        </div>
      )}

      {!isError && file.status !== "reading" && (
        <MetadataEditor
          file={file}
          totalFiles={totalFiles}
          onChange={onCustomChange}
          onCoverArt={onCoverArt}
          onClearCoverArt={onClearCoverArt}
          onApplyToAll={onApplyToAll}
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
    addFiles, 
    removeFile, 
    cleanFile, 
    cleanAll, 
    downloadFile, 
    downloadAll,
    setCustomMetadata,
    setCoverArt,
    clearCoverArt,
    applyToAll,
  } = useMetaClean();

  const canCleanAll = files.some(f => f.status === "ready" || f.status === "queued");
  const canDownloadAll = files.filter(f => f.status === "done").length > 1;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto max-w-5xl h-16 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
              <Settings2 className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight">MetaClean</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-1.5 hidden sm:flex">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              Files never leave your browser
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto max-w-5xl px-4 py-8 space-y-8">
        
        <div className="grid gap-8 md:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <DropZone onDrop={addFiles} />
            <AnimatePresence>
              {isEngineLoading && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-center p-4 text-sm text-muted-foreground bg-accent/50 rounded-lg"
                >
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin text-primary" />
                  Loading audio engine...
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Card className="h-fit">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">Processing Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="keep-basic" 
                    checked={options.keepBasicTags}
                    onCheckedChange={(c) => setOptions(prev => ({ ...prev, keepBasicTags: !!c }))}
                  />
                  <div className="space-y-1 leading-none">
                    <label htmlFor="keep-basic" className="text-sm font-medium cursor-pointer">
                      Keep basic tags
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Preserve Title, Artist, and Album.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="remove-art" 
                    checked={options.removeCoverArt}
                    onCheckedChange={(c) => setOptions(prev => ({ ...prev, removeCoverArt: !!c }))}
                  />
                  <div className="space-y-1 leading-none">
                    <label htmlFor="remove-art" className="text-sm font-medium cursor-pointer">
                      Remove cover art
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Strip embedded images to save space.
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3 pt-2">
                <Button 
                  className="w-full" 
                  size="lg" 
                  disabled={!canCleanAll}
                  onClick={cleanAll}
                >
                  Clean All
                </Button>
                
                <AnimatePresence>
                  {canDownloadAll && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                      <Button 
                        variant="secondary" 
                        className="w-full mt-3" 
                        onClick={downloadAll}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download All (.zip)
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </CardContent>
          </Card>
        </div>

        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Queue ({files.length})</h2>
            </div>
            
            <div className="space-y-3">
              <AnimatePresence>
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
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>
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