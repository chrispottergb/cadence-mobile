import { supabase } from '@/auth/supabase';

/**
 * The app's only doorway to music: the Cadence Music Service. The app never
 * learns which provider is behind it, never sees provider ids or URLs, and
 * plays audio only through short-lived signed URLs the service issues after
 * its own authorization check.
 */
const baseUrl = (process.env.EXPO_PUBLIC_MUSIC_SERVICE_URL ?? '').replace(/\/+$/, '');

export interface ModelDescriptor {
  key: string;
  label: string;
  maxDurationSeconds: number;
  studentSelectable: boolean;
}

export interface Capabilities {
  customLyrics: { supported: boolean; maxChars?: number };
  descriptionMode: { supported: boolean; maxChars?: number };
  instrumental: boolean;
  styleTags: { supported: boolean; maxChars?: number };
  negativeTags: { supported: boolean; maxChars?: number };
  models: ModelDescriptor[];
  defaultModel: string;
  targetDuration: { supported: boolean; minSeconds?: number; maxSeconds?: number };
  candidatesPerJob: number;
}

export type JobState = 'QUEUED' | 'SUBMITTED' | 'RENDERING' | 'READY' | 'PARTIAL' | 'FAILED';
export const TERMINAL: readonly JobState[] = ['READY', 'PARTIAL', 'FAILED'];

export interface Candidate {
  id: string;
  candidateIndex: number;
  label: string;
  status: 'pending' | 'rendering' | 'processing' | 'ready' | 'failed';
  lifecycle: string;
  title: string | null;
  durationSeconds: number | null;
  playable: boolean;
  style?: string | null;
}

export interface GenerationJob {
  id: string;
  state: JobState;
  errorCode: string | null;
  createdAt?: string | null;
  candidates: Candidate[];
}

export type Subject = { type: 'profile' } | { type: 'gym'; gymId: string };

export interface GenerateInput {
  mode: 'description' | 'lyrics';
  description?: string;
  lyrics?: string;
  title?: string;
  style: { genre?: string; tags: string[]; exclude: string[] };
  instrumental: boolean;
  targetDurationSeconds?: number;
  subject: Subject;
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, status: 401, error: 'not_signed_in' };
  if (!baseUrl) return { ok: false, status: 0, error: 'service_not_configured' };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : `http_${res.status}` };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
}

export const fetchCapabilities = () => call<Capabilities>('/v1/music/capabilities');

/**
 * Start a generation. The idempotency key identifies ONE user intent: reuse
 * it when retrying the same press (timeout, app backgrounded, double tap) so
 * the service returns the same job instead of paying for another.
 */
export const createGeneration = (input: GenerateInput, idempotencyKey: string) =>
  call<GenerationJob>('/v1/generations', { method: 'POST', body: JSON.stringify(input), headers: { 'idempotency-key': idempotencyKey } });

/** Finished generations the caller may play (own personal music + current gyms' class music). */
export const listGenerations = () => call<{ generations: GenerationJob[] }>('/v1/generations?limit=50');

export const getGeneration = (id: string) => call<GenerationJob>(`/v1/generations/${id}`);

export const setLifecycle = (trackId: string, lifecycle: 'previewed' | 'selected' | 'unselected') =>
  call<GenerationJob>(`/v1/tracks/${trackId}/lifecycle`, { method: 'POST', body: JSON.stringify({ lifecycle }) });

/** ttlSeconds is honoured only by a server with the development-only short-link setting; it can only shorten. */
export const getPlaybackUrl = (trackId: string, ttlSeconds?: number) =>
  call<{ url: string; expiresInSeconds: number }>(`/v1/tracks/${trackId}/playback${ttlSeconds ? `?ttl=${Math.round(ttlSeconds)}` : ''}`);

/** Plain-language message for a service error code. Never shows vendor detail. */
export function describeError(code: string): string {
  switch (code) {
    case 'quota_exhausted':
      return 'This allowance is used up for the current period.';
    case 'no_allowance':
      return 'No music allowance is set up for this account or gym yet.';
    case 'subject_forbidden':
      return 'You are not allowed to create music for that gym.';
    case 'rate_limited':
      return 'Too many requests. Wait a minute and try again.';
    case 'unsupported_request':
      return 'Some of these settings are not supported right now.';
    case 'network':
      return 'Could not reach the music service. Check your connection.';
    case 'service_not_configured':
      return 'The music service is not configured in this build.';
    default:
      return 'Something went wrong. Try again.';
  }
}
