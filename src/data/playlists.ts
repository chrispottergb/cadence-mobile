import { supabase } from '@/auth/supabase';

/**
 * Playlists hold track ids only. Row-level security decides who can see or
 * change them: gym staff for gym playlists, the owner for personal ones, and
 * a track can only be added if the caller is already allowed to see it.
 */
export type PlaylistOwner = { type: 'gym'; id: string } | { type: 'profile'; id: string };

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}

export async function listPlaylists(owner: PlaylistOwner): Promise<{ playlists: Playlist[]; error: string | null }> {
  const { data, error } = await supabase
    .from('playlists')
    .select('id, name, playlist_items(track_id, position)')
    .eq('owner_type', owner.type)
    .eq('owner_id', owner.id)
    .order('created_at', { ascending: false });
  if (error) return { playlists: [], error: error.message };
  const rows = (data ?? []) as {
    id: string;
    name: string;
    playlist_items: { track_id: string; position: number }[];
  }[];
  return {
    playlists: rows.map((r) => ({
      id: r.id,
      name: r.name,
      trackIds: [...r.playlist_items].sort((a, b) => a.position - b.position).map((i) => i.track_id),
    })),
    error: null,
  };
}

export async function createPlaylist(owner: PlaylistOwner, name: string): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.from('playlists').insert({ owner_type: owner.type, owner_id: owner.id, name: name.trim() }).select('id').single();
  return {
    id: (data as { id: string } | null)?.id ?? null,
    error: error?.message ?? null,
  };
}

export async function addToPlaylist(playlist: Playlist, trackId: string): Promise<string | null> {
  if (playlist.trackIds.includes(trackId)) return null; // already there: nothing to do
  const { error } = await supabase.from('playlist_items').insert({
    playlist_id: playlist.id,
    track_id: trackId,
    position: playlist.trackIds.length,
  });
  return error?.message ?? null;
}

export async function removeFromPlaylist(playlistId: string, trackId: string): Promise<string | null> {
  const { error } = await supabase.from('playlist_items').delete().eq('playlist_id', playlistId).eq('track_id', trackId);
  return error?.message ?? null;
}
