import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import { getGeneration, getPlaybackUrl } from '@/music/client';
import { supabase } from '@/auth/supabase';

import type { CueAsset, LoadedTrack } from './engine';
import { record } from './metrics';

/**
 * Authorized asset resolution for the Audio Lab.
 *
 * Every track comes from Cadence's own service with the user's session: the
 * service checks access and returns a short-lived signed URL. Two modes:
 *   download - fetch the file once into a LAB-ONLY cache, play locally
 *   stream   - hand the signed URL straight to the engine (URL-expiry test)
 * The lab cache is development-only and cleared by clearLabCache(); it is
 * not the offline library and is never used outside the lab.
 */
const baseUrl = (process.env.EXPO_PUBLIC_MUSIC_SERVICE_URL ?? '').replace(/\/+$/, '');
export const LAB_CACHE = `${FileSystem.cacheDirectory}audiolab/`;

export interface PlayableTrack {
  trackId: string;
  title: string;
  durationSeconds: number;
  jobId: string;
  label: string;
  /** Bundled demo track (test builds only): no account or network needed. */
  demo?: number;
}

/**
 * Bundled demo tracks so the lab runs with no sign-in and no generated music.
 * Synthesized locally (no provider credits). Signed-URL and network tests
 * still need real authorized tracks.
 */
const DEMO_TRACKS: PlayableTrack[] = [
  { trackId: 'demo-a', title: 'Demo A (120 bpm)', durationSeconds: 60, jobId: 'demo', label: 'A', demo: require('../../assets/audiolab/demo/demo-a.mp3') },
  { trackId: 'demo-b', title: 'Demo B (96 bpm)', durationSeconds: 60, jobId: 'demo', label: 'B', demo: require('../../assets/audiolab/demo/demo-b.mp3') },
  { trackId: 'demo-c', title: 'Demo C (140 bpm)', durationSeconds: 60, jobId: 'demo', label: 'C', demo: require('../../assets/audiolab/demo/demo-c.mp3') },
];

/** Tracks the signed-in user is authorized to play (their own + current-gym music). */
export async function listPlayable(): Promise<PlayableTrack[]> {
  const real = await listAuthorized().catch(() => [] as PlayableTrack[]);
  return real.length >= 2 ? real : [...real, ...DEMO_TRACKS];
}

async function listAuthorized(): Promise<PlayableTrack[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || !baseUrl) return [];
  const res = await fetch(`${baseUrl}/v1/generations?limit=20`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const body = (await res.json()) as { generations: { id: string; candidates: { id: string; label: string; title: string | null; durationSeconds: number | null; playable: boolean }[] }[] };
  const out: PlayableTrack[] = [];
  for (const g of body.generations) {
    for (const c of g.candidates) {
      if (c.playable && c.durationSeconds) out.push({ trackId: c.id, title: c.title ?? 'Untitled', durationSeconds: c.durationSeconds, jobId: g.id, label: c.label });
    }
  }
  return out;
}

export async function resolveTrack(t: PlayableTrack, mode: 'download' | 'stream', shortTtlSeconds?: number): Promise<LoadedTrack> {
  const t0 = Date.now();
  if (t.demo !== undefined) {
    const a = Asset.fromModule(t.demo);
    await a.downloadAsync();
    record('assets', 'demo_track', { track: t.trackId, ms: Date.now() - t0 });
    return { trackId: t.trackId, source: a.localUri ?? a.uri, durationSeconds: t.durationSeconds };
  }
  const signed = await getPlaybackUrl(t.trackId, mode === 'stream' ? shortTtlSeconds : undefined);
  if (!signed.ok) throw new Error(`playback not authorized (${signed.error})`);
  if (mode === 'stream') {
    record('assets', 'signed_url', { track: t.trackId, ms: Date.now() - t0, expiresIn: signed.data.expiresInSeconds, requestedTtl: shortTtlSeconds ?? null, expiresAt: Date.now() + signed.data.expiresInSeconds * 1000 });
    return { trackId: t.trackId, source: signed.data.url, durationSeconds: t.durationSeconds };
  }
  await FileSystem.makeDirectoryAsync(LAB_CACHE, { intermediates: true }).catch(() => undefined);
  const dest = `${LAB_CACHE}${t.trackId}.mp3`;
  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists) {
    const r = await FileSystem.downloadAsync(signed.data.url, dest);
    if (r.status !== 200) throw new Error(`download failed (${r.status})`);
  }
  const size = (await FileSystem.getInfoAsync(dest)) as { size?: number };
  record('assets', 'downloaded', { track: t.trackId, ms: Date.now() - t0, bytes: size.size ?? 0, cached: info.exists });
  return { trackId: t.trackId, source: dest, durationSeconds: t.durationSeconds };
}

/** Re-sign a streamed track (used after a URL has expired). */
export async function refreshSignedUrl(trackId: string): Promise<string | null> {
  const r = await getPlaybackUrl(trackId);
  record('assets', 'signed_url_refresh', { track: trackId, ok: r.ok });
  return r.ok ? r.data.url : null;
}

export async function clearLabCache(): Promise<void> {
  await FileSystem.deleteAsync(LAB_CACHE, { idempotent: true });
  record('assets', 'cache_cleared', {});
}

/** The fixed Stage A cue set: bundled, prerecorded, no runtime TTS. Durations measured from the WAV data chunks. */
const CUE_MODULES = {
  bell: { mod: require('../../assets/audiolab/cue-bell.wav'), seconds: 1.6 },
  round: { mod: require('../../assets/audiolab/cue-round-begins.wav'), seconds: 1.594 },
  thirty: { mod: require('../../assets/audiolab/cue-thirty-seconds.wav'), seconds: 1.949 },
  switch: { mod: require('../../assets/audiolab/cue-switch.wav'), seconds: 1.174 },
  stop: { mod: require('../../assets/audiolab/cue-stop.wav'), seconds: 1.229 },
} as const;
export type CueId = keyof typeof CUE_MODULES;

export async function loadCueAssets(): Promise<CueAsset[]> {
  const out: CueAsset[] = [];
  for (const [assetId, c] of Object.entries(CUE_MODULES)) {
    const a = Asset.fromModule(c.mod);
    await a.downloadAsync();
    out.push({ assetId, source: a.localUri ?? a.uri, durationSeconds: c.seconds });
  }
  return out;
}

export const cueSeconds = (id: CueId) => CUE_MODULES[id].seconds;

export { getGeneration };
