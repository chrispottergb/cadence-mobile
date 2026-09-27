import { supabase } from '@/auth/supabase';

/**
 * The app's only doorway to music generation: the Cadence Music Service. The
 * app never learns which provider is behind it. Phase 1 fetches capabilities
 * only; the generator UI that consumes them is a later phase.
 */
const baseUrl = (process.env.EXPO_PUBLIC_MUSIC_SERVICE_URL ?? '').replace(/\/+$/, '');

export interface Capabilities {
  candidatesPerJob: number;
  targetDuration: { supported: boolean; minSeconds?: number; maxSeconds?: number };
  models: { key: string; label: string; maxDurationSeconds: number; studentSelectable: boolean }[];
  [k: string]: unknown;
}

export async function fetchCapabilities(): Promise<{ caps: Capabilities | null; error: string | null }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { caps: null, error: 'Not signed in.' };
  if (!baseUrl) return { caps: null, error: 'Music service URL not configured.' };
  try {
    const res = await fetch(`${baseUrl}/v1/music/capabilities`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { caps: null, error: `Service responded ${res.status}.` };
    return { caps: (await res.json()) as Capabilities, error: null };
  } catch {
    return { caps: null, error: 'Could not reach the music service.' };
  }
}
