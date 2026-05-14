import { useRef, useState } from "react";
import { Image as ImageIcon, X, CopyCheck, ChevronDown, FileMusic } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AudioFile,
  type CustomMetadata,
} from "@/hooks/use-metaclean";
import { FORMATS, type OutputFormat } from "@/lib/ffmpeg";

interface Props {
  file: AudioFile;
  totalFiles: number;
  onChange: (id: string, patch: Partial<CustomMetadata>) => void;
  onCoverArt: (id: string, file: File) => void;
  onClearCoverArt: (id: string) => void;
  onApplyToAll: (id: string) => void;
  onSetFormat: (id: string, fmt: OutputFormat) => void;
  onSetBitrate: (id: string, br: number | undefined) => void;
}

export function MetadataEditor({
  file,
  totalFiles,
  onChange,
  onCoverArt,
  onClearCoverArt,
  onApplyToAll,
  onSetFormat,
  onSetBitrate,
}: Props) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const m = file.customMetadata ?? {};

  const resolvedFmtKey =
    file.outputFormat === "same"
      ? ((file.file.name.split(".").pop() || "").toLowerCase() as keyof typeof FORMATS)
      : file.outputFormat;
  const resolvedFmt = (FORMATS as any)[resolvedFmtKey] ?? FORMATS.mp3;
  const coverSupported = resolvedFmt.supportsCoverArt;
  const showBitrate = !resolvedFmt.lossless && file.outputFormat !== "same";

  const previewSrc = file.coverArt?.dataUrl || file.originalCoverDataUrl;
  const previewIsCustom = !!file.coverArt;

  const field = (
    label: string,
    key: keyof CustomMetadata,
    placeholder?: string,
    type: "text" | "number" = "text"
  ) => (
    <div className="space-y-1.5">
      <Label
        htmlFor={`${file.id}-${key}`}
        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
      >
        {label}
      </Label>
      <Input
        id={`${file.id}-${key}`}
        type={type}
        value={(m[key] as string) ?? ""}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(file.id, { [key]: e.target.value } as Partial<CustomMetadata>)
        }
      />
    </div>
  );

  const hasEdits =
    (file.customMetadata && Object.values(file.customMetadata).some(Boolean)) ||
    !!file.coverArt;

  return (
    <div className="border-t pt-3 -mx-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-1 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2">
          Tags, art & output format
          {hasEdits && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />}
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid gap-5 md:grid-cols-[160px_1fr] pt-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Album art
                </Label>
                <div
                  className={`relative w-40 h-40 rounded-md border-2 border-dashed flex items-center justify-center overflow-hidden bg-accent/30 transition-colors ${
                    coverSupported
                      ? "border-border cursor-pointer hover:border-primary/50"
                      : "border-border/50 opacity-60 cursor-not-allowed"
                  }`}
                  onClick={() => coverSupported && fileInputRef.current?.click()}
                >
                  {previewSrc ? (
                    <>
                      <img
                        src={previewSrc}
                        alt="Cover"
                        className="w-full h-full object-cover"
                      />
                      {!previewIsCustom && (
                        <div className="absolute bottom-0 inset-x-0 bg-background/80 backdrop-blur text-[10px] uppercase tracking-wider text-center py-0.5 text-muted-foreground">
                          Original
                        </div>
                      )}
                      {previewIsCustom && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearCoverArt(file.id);
                          }}
                          className="absolute top-1.5 right-1.5 p-1 rounded-full bg-background/90 backdrop-blur text-foreground shadow hover:bg-destructive hover:text-destructive-foreground transition-colors"
                          title="Remove custom cover"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs px-3 text-center">
                      <ImageIcon className="w-6 h-6" />
                      <span>
                        {coverSupported
                          ? "Click to upload\nJPG or PNG"
                          : "Album art not supported in this output format"}
                      </span>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onCoverArt(file.id, f);
                      e.target.value = "";
                    }}
                  />
                </div>
                {coverSupported && previewSrc && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {previewIsCustom
                      ? "Replaces the original art."
                      : "Click to replace with your own."}
                  </p>
                )}
                {!coverSupported && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Use MP3, FLAC, or M4A output to embed art.
                  </p>
                )}
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Output format
                    </Label>
                    <Select
                      value={file.outputFormat}
                      onValueChange={(v) => onSetFormat(file.id, v as OutputFormat)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same">
                          <span className="flex items-center gap-2">
                            <FileMusic className="w-3.5 h-3.5" />
                            Same as input (fastest, no re-encode)
                          </span>
                        </SelectItem>
                        {(Object.keys(FORMATS) as Array<keyof typeof FORMATS>).map((k) => (
                          <SelectItem key={k} value={k}>
                            <span className="flex items-center justify-between gap-3 w-full">
                              <span>{FORMATS[k].label}</span>
                              <span className="text-xs text-muted-foreground">
                                {FORMATS[k].description}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {showBitrate && resolvedFmt.bitrates && (
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Bitrate
                      </Label>
                      <Select
                        value={String(file.outputBitrate ?? resolvedFmt.defaultBitrate)}
                        onValueChange={(v) => onSetBitrate(file.id, Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {resolvedFmt.bitrates.map((b: number) => (
                            <SelectItem key={b} value={String(b)}>
                              {b} kbps
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {field("Title", "title", "Song title")}
                  {field("Artist", "artist", "Artist name")}
                  {field("Album", "album", "Album name")}
                  {field("Album artist", "albumArtist", "Album artist")}
                  {field("Year", "year", "2026", "number")}
                  {field("Track #", "track", "1")}
                  {field("Genre", "genre", "Electronic")}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor={`${file.id}-comment-empty`}
                      className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      &nbsp;
                    </Label>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label
                      htmlFor={`${file.id}-comment`}
                      className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Comment
                    </Label>
                    <Textarea
                      id={`${file.id}-comment`}
                      value={m.comment ?? ""}
                      rows={2}
                      placeholder="Optional comment"
                      onChange={(e) => onChange(file.id, { comment: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {totalFiles > 1 && (
              <div className="flex items-center justify-end pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onApplyToAll(file.id)}
                  className="text-xs"
                >
                  <CopyCheck className="w-3.5 h-3.5 mr-1.5" />
                  Apply tags & art to all files
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
