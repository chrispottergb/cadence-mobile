import { supabase } from '@/auth/supabase';
import { type ClassSoundtrack, parseSoundtrack, SCHEMA_VERSION } from '@/soundtrack/model';

/**
 * Class Soundtrack persistence. Rows are gym assets: RLS lets current gym
 * staff read and write them; `created_by` is attribution only. Saves use the
 * row revision for optimistic concurrency: a stale save is refused rather
 * than silently overwriting someone else's edit.
 */
export interface SoundtrackRow {
  id: string;
  gymId: string;
  name: string;
  durationSeconds: number;
  revision: number;
  updatedAt: string;
}

export interface LoadedSoundtrack extends SoundtrackRow {
  soundtrack: ClassSoundtrack;
}

const COLS = 'id, gym_id, name, duration_seconds, revision, updated_at';
type Raw = { id: string; gym_id: string; name: string; duration_seconds: number | string; revision: number; updated_at: string; document?: unknown };
const toRow = (r: Raw): SoundtrackRow => ({ id: r.id, gymId: r.gym_id, name: r.name, durationSeconds: Number(r.duration_seconds), revision: r.revision, updatedAt: r.updated_at });

export async function listSoundtracks(gymId: string): Promise<{ rows: SoundtrackRow[]; error: string | null }> {
  const { data, error } = await supabase.from('class_soundtracks').select(COLS).eq('gym_id', gymId).order('updated_at', { ascending: false });
  return { rows: ((data ?? []) as Raw[]).map(toRow), error: error?.message ?? null };
}

export async function loadSoundtrack(id: string): Promise<{ value: LoadedSoundtrack | null; error: string | null }> {
  const { data, error } = await supabase.from('class_soundtracks').select(`${COLS}, document`).eq('id', id).single();
  if (error || !data) return { value: null, error: error?.message ?? 'not found' };
  const parsed = parseSoundtrack((data as Raw).document);
  if (!parsed.ok) return { value: null, error: `This soundtrack could not be read (${parsed.error}).` };
  return { value: { ...toRow(data as Raw), soundtrack: parsed.value }, error: null };
}

export async function createSoundtrack(gymId: string, profileId: string, s: ClassSoundtrack): Promise<{ id: string | null; revision: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from('class_soundtracks')
    .insert({ gym_id: gymId, name: s.name, duration_seconds: s.durationSeconds, schema_version: SCHEMA_VERSION, document: s, created_by: profileId })
    .select('id, revision')
    .single();
  const row = data as { id: string; revision: number } | null;
  return { id: row?.id ?? null, revision: row?.revision ?? null, error: error?.message ?? null };
}

/** Save with the revision the editor loaded; returns the new revision, or 'stale' if someone saved first. */
export async function saveSoundtrack(id: string, loadedRevision: number, s: ClassSoundtrack): Promise<{ revision: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from('class_soundtracks')
    .update({ name: s.name, duration_seconds: s.durationSeconds, schema_version: SCHEMA_VERSION, document: s, revision: loadedRevision + 1 })
    .eq('id', id)
    .select('revision')
    .single();
  if (error) return { revision: null, error: error.message.includes('stale_revision') ? 'stale' : error.message };
  return { revision: (data as { revision: number }).revision, error: null };
}

export async function deleteSoundtrack(id: string): Promise<string | null> {
  const { error } = await supabase.from('class_soundtracks').delete().eq('id', id);
  return error?.message ?? null;
}
