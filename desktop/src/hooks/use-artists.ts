import { useCallback, useEffect, useState } from "react";
import { loadArtists, saveArtists, type Artist } from "@/lib/artists";

export function useArtists() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setArtists(loadArtists());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveArtists(artists);
  }, [artists, loaded]);

  const addArtist = useCallback((data: Omit<Artist, "id">) => {
    const id = crypto.randomUUID();
    const next: Artist = { id, ...data };
    setArtists((prev) => [...prev, next]);
    return next;
  }, []);

  const updateArtist = useCallback((id: string, patch: Partial<Artist>) => {
    setArtists((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const removeArtist = useCallback((id: string) => {
    setArtists((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const getArtist = useCallback(
    (id: string) => artists.find((a) => a.id === id),
    [artists]
  );

  return { artists, addArtist, updateArtist, removeArtist, getArtist };
}
