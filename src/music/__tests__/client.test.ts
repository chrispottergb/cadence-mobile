const mockGetSession = jest.fn();
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { getSession: () => mockGetSession() } } }));

// The client reads its base URL at import time, so set it before loading.
process.env.EXPO_PUBLIC_MUSIC_SERVICE_URL = 'https://music.cadence.test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createGeneration, describeError, getPlaybackUrl } = require('../client') as typeof import('../client');

const input = {
  mode: 'description' as const,
  description: 'warmup',
  style: { tags: ['driving'], exclude: [] },
  instrumental: true,
  targetDurationSeconds: 120,
  subject: { type: 'profile' as const },
};

describe('music service client', () => {
  let calls: { url: string; init: RequestInit }[];
  beforeEach(() => {
    calls = [];
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } });
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'job-1', state: 'SUBMITTED', errorCode: null, candidates: [] }), { status: 202 });
    }) as unknown as typeof fetch;
  });

  it('sends the idempotency key and the user session to OUR service only', async () => {
    const r = await createGeneration(input, 'key-12345678');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://music.cadence.test/v1/generations');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['idempotency-key']).toBe('key-12345678');
    expect(h.authorization).toBe('Bearer user-jwt');
    expect(calls[0]!.url).not.toMatch(/musicapi|apiframe|suno/i);
  });

  it('a retry with the same key sends the same key', async () => {
    await createGeneration(input, 'same-key-000');
    await createGeneration(input, 'same-key-000');
    expect(calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key'])).toEqual(['same-key-000', 'same-key-000']);
  });

  it('does nothing when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const r = await getPlaybackUrl('t1');
    expect(r).toEqual({ ok: false, status: 401, error: 'not_signed_in' });
    expect(calls).toHaveLength(0);
  });

  it('turns service error codes into plain language without vendor detail', () => {
    for (const code of ['quota_exhausted', 'no_allowance', 'subject_forbidden', 'rate_limited', 'anything_else']) {
      expect(describeError(code)).not.toMatch(/musicapi|provider|credit|suno|http/i);
    }
  });
});
