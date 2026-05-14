import { useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Image as ImageIcon,
  Plus,
  Pencil,
  Trash2,
  X,
  User,
  Save,
  ArrowLeft,
} from "lucide-react";
import type { Artist } from "@/lib/artists";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  artists: Artist[];
  addArtist: (data: Omit<Artist, "id">) => Artist;
  updateArtist: (id: string, patch: Partial<Artist>) => void;
  removeArtist: (id: string) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const EMPTY: Omit<Artist, "id"> = {
  name: "",
  album: "",
  albumArtist: "",
  year: "",
  genre: "",
  comment: "",
  coverDataUrl: undefined,
};

export function ArtistManager({
  open,
  onOpenChange,
  artists,
  addArtist,
  updateArtist,
  removeArtist,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<Omit<Artist, "id">>(EMPTY);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setIsCreating(false);
      setDraft(EMPTY);
    }
  }, [open]);

  const startCreate = () => {
    setEditingId(null);
    setIsCreating(true);
    setDraft(EMPTY);
  };

  const startEdit = (a: Artist) => {
    setIsCreating(false);
    setEditingId(a.id);
    setDraft({
      name: a.name,
      album: a.album ?? "",
      albumArtist: a.albumArtist ?? "",
      year: a.year ?? "",
      genre: a.genre ?? "",
      comment: a.comment ?? "",
      coverDataUrl: a.coverDataUrl,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsCreating(false);
    setDraft(EMPTY);
  };

  const handleCover = async (file: File) => {
    const url = await readFileAsDataUrl(file);
    setDraft((d) => ({ ...d, coverDataUrl: url }));
  };

  const save = () => {
    const name = draft.name.trim();
    if (!name) return;
    const cleanDraft: Omit<Artist, "id"> = {
      name,
      album: draft.album?.trim() || undefined,
      albumArtist: draft.albumArtist?.trim() || undefined,
      year: draft.year?.trim() || undefined,
      genre: draft.genre?.trim() || undefined,
      comment: draft.comment?.trim() || undefined,
      coverDataUrl: draft.coverDataUrl,
    };
    if (editingId) {
      updateArtist(editingId, cleanDraft);
    } else {
      addArtist(cleanDraft);
    }
    cancelEdit();
  };

  const isEditing = isCreating || editingId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5" />
            {isEditing ? (
              <>
                <button
                  onClick={cancelEdit}
                  className="p-1 -ml-1 rounded hover:bg-accent"
                  type="button"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                {editingId ? "Edit artist" : "Add artist"}
              </>
            ) : (
              "Artist library"
            )}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Saved here, then one click to apply to any file."
              : "Save artists with their cover & defaults. Pick one in the file editor and everything autofills — including the song title from the filename."}
          </DialogDescription>
        </DialogHeader>

        {!isEditing ? (
          <>
            <ScrollArea className="flex-1 px-6 py-4 max-h-[55vh]">
              {artists.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <User className="w-10 h-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                    No artists yet. Create your first one.
                  </p>
                  <Button onClick={startCreate}>
                    <Plus className="w-4 h-4 mr-2" /> Add artist
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {artists.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3"
                    >
                      <div className="w-12 h-12 rounded-md overflow-hidden bg-accent shrink-0 flex items-center justify-center">
                        {a.coverDataUrl ? (
                          <img
                            src={a.coverDataUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{a.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[a.album, a.year, a.genre].filter(Boolean).join(" • ") ||
                            "No defaults set"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(a)}
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeArtist(a.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            <DialogFooter className="px-6 py-4 border-t">
              {artists.length > 0 && (
                <Button onClick={startCreate} className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" /> Add artist
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <ScrollArea className="flex-1 px-6 py-4 max-h-[60vh]">
              <div className="grid gap-5 md:grid-cols-[160px_1fr]">
                <div className="space-y-2">
                  <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Cover art
                  </Label>
                  <div
                    className="relative w-40 h-40 rounded-md border-2 border-dashed border-border cursor-pointer overflow-hidden bg-accent/30 flex items-center justify-center hover:border-primary/50"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {draft.coverDataUrl ? (
                      <>
                        <img
                          src={draft.coverDataUrl}
                          alt="Cover"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDraft((d) => ({ ...d, coverDataUrl: undefined }));
                          }}
                          className="absolute top-1.5 right-1.5 p-1 rounded-full bg-background/90 backdrop-blur shadow hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs px-3 text-center">
                        <ImageIcon className="w-6 h-6" />
                        <span>Click to upload\nJPG or PNG</span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleCover(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label
                      htmlFor="artist-name"
                      className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Artist name *
                    </Label>
                    <Input
                      id="artist-name"
                      value={draft.name}
                      autoFocus
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Daft Punk"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Album artist
                    </Label>
                    <Input
                      value={draft.albumArtist ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, albumArtist: e.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Album
                    </Label>
                    <Input
                      value={draft.album ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, album: e.target.value }))
                      }
                      placeholder="Album name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Year
                    </Label>
                    <Input
                      type="number"
                      value={draft.year ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, year: e.target.value }))
                      }
                      placeholder="2026"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Genre
                    </Label>
                    <Input
                      value={draft.genre ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, genre: e.target.value }))
                      }
                      placeholder="Electronic"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Comment
                    </Label>
                    <Textarea
                      rows={2}
                      value={draft.comment ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, comment: e.target.value }))
                      }
                      placeholder="Optional default comment"
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="px-6 py-4 border-t gap-2">
              <Button variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!draft.name.trim()}>
                <Save className="w-4 h-4 mr-2" />
                {editingId ? "Save changes" : "Create artist"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
