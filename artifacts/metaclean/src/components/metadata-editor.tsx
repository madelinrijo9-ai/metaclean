import { useRef, useState } from "react";
import { Image as ImageIcon, X, CopyCheck, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTS_COVER_ART, getExt, type AudioFile, type CustomMetadata } from "@/hooks/use-metaclean";

interface Props {
  file: AudioFile;
  totalFiles: number;
  onChange: (id: string, patch: Partial<CustomMetadata>) => void;
  onCoverArt: (id: string, file: File) => void;
  onClearCoverArt: (id: string) => void;
  onApplyToAll: (id: string) => void;
}

export function MetadataEditor({
  file,
  totalFiles,
  onChange,
  onCoverArt,
  onClearCoverArt,
  onApplyToAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const m = file.customMetadata ?? {};
  const coverSupported = SUPPORTS_COVER_ART.has(getExt(file.file.name));

  const field = (
    label: string,
    key: keyof CustomMetadata,
    placeholder?: string,
    type: "text" | "number" = "text"
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${file.id}-${key}`} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </Label>
      <Input
        id={`${file.id}-${key}`}
        type={type}
        value={(m[key] as string) ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(file.id, { [key]: e.target.value } as Partial<CustomMetadata>)}
      />
    </div>
  );

  return (
    <div className="border-t pt-3 -mx-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-1 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2">
          Tags & album art
          {(file.customMetadata && Object.values(file.customMetadata).some(Boolean)) || file.coverArt ? (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          ) : null}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
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
            <div className="grid gap-4 md:grid-cols-[160px_1fr] pt-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
                  {file.coverArt ? (
                    <>
                      <img
                        src={file.coverArt.dataUrl}
                        alt="Cover"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClearCoverArt(file.id);
                        }}
                        className="absolute top-1.5 right-1.5 p-1 rounded-full bg-background/90 backdrop-blur text-foreground shadow hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        title="Remove cover"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs px-3 text-center">
                      <ImageIcon className="w-6 h-6" />
                      <span>{coverSupported ? "Click to upload\nJPG or PNG" : "Cover art not supported for this format"}</span>
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
                {!coverSupported && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Use MP3, FLAC, or M4A to embed album art.
                  </p>
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
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`${file.id}-comment`} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
