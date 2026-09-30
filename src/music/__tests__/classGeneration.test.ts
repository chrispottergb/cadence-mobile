import { advanceGeneration, musicComplete, type ClassGeneration } from '../classGeneration';
import { createGeneration, getGeneration, type Capabilities } from '../client';
import { defaultInstructorSettings, proposeClass } from '@/soundtrack/instructor';

jest.mock('../client', () => ({ createGeneration: jest.fn(), getGeneration: jest.fn(), describeError: (s: string) => s, TERMINAL: ['READY', 'PARTIAL', 'FAILED'] }));
const create = jest.mocked(createGeneration);
const get = jest.mocked(getGeneration);
const settings = { ...defaultInstructorSettings(), minutes: 5, warmup: 0, cooldown: 0, repeatMusic: true };
const caps: Capabilities = { customLyrics: { supported: true }, descriptionMode: { supported: true }, instrumental: true, styleTags: { supported: true }, negativeTags: { supported: false }, models: [], defaultModel: 'default', targetDuration: { supported: true, maxSeconds: 120 }, candidatesPerJob: 2 };
const initial = (): ClassGeneration => ({ plan: proposeClass(settings), tracks: [], requests: 0 });
const ready = { id: 'job1', state: 'PARTIAL' as const, errorCode: null, candidates: [{ id: 'track1', candidateIndex: 0, label: 'A', status: 'ready' as const, lifecycle: 'generated', title: 'Song', durationSeconds: 100, playable: true }] };
beforeEach(() => jest.clearAllMocks());

it('persists intent before submitting and reuses the same key after a lost response', async () => {
  let disk = initial();
  const save = async (s: ClassGeneration) => { disk = JSON.parse(JSON.stringify(s)); };
  create.mockImplementationOnce(async (_input, key) => { expect(disk.pending?.key).toBe(key); return { ok: false, status: 0, error: 'network' }; });
  await expect(advanceGeneration(disk, settings, caps, 'gym', save)).rejects.toThrow('network');
  const key = disk.pending!.key;
  create.mockResolvedValueOnce({ ok: true, data: ready });
  const done = await advanceGeneration(disk, settings, caps, 'gym', save);
  expect(create.mock.calls[1]![1]).toBe(key);
  expect(done.requests).toBe(1);
  expect(done.tracks[0]!.durationSeconds).toBe(100);
  expect(musicComplete(done.plan)).toBe(true);
});

it('resumes a stored job by polling without creating another paid request', async () => {
  let disk = initial();
  const save = async (s: ClassGeneration) => { disk = JSON.parse(JSON.stringify(s)); };
  create.mockResolvedValueOnce({ ok: true, data: { ...ready, state: 'RENDERING', candidates: [] } });
  await advanceGeneration(disk, settings, caps, 'gym', save);
  get.mockResolvedValueOnce({ ok: true, data: ready });
  await advanceGeneration(disk, settings, caps, 'gym', save);
  expect(create).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('job1');
  expect(disk.tracks).toHaveLength(1);
  await advanceGeneration(disk, settings, caps, 'gym', save);
  expect(get).toHaveBeenCalledTimes(1);
});

it('does not send a request when durable storage fails', async () => {
  await expect(advanceGeneration(initial(), settings, caps, 'gym', async () => { throw new Error('disk full'); })).rejects.toThrow('disk full');
  expect(create).not.toHaveBeenCalled();
});

it('retains failed job identity and prevents an automatic paid retry', async () => {
  create.mockResolvedValueOnce({ ok: true, data: { ...ready, state: 'FAILED', candidates: [] } });
  const result = await advanceGeneration(initial(), settings, caps, 'gym', async () => {});
  expect(result.failure).toMatch(/playable/);
  expect(result.pending?.jobId).toBe('job1');
  await advanceGeneration(result, settings, caps, 'gym', async () => {});
  expect(create).toHaveBeenCalledTimes(1);
});

it('does not spend another request on a tail shorter than the minimum clip', async () => {
  const state = initial();
  state.plan.sections[0]!.music = [{ assetId: 'short', label: 'short', durationSeconds: 298 }];
  expect(musicComplete(state.plan)).toBe(true);
  await advanceGeneration(state, settings, caps, 'gym', async () => {});
  expect(create).not.toHaveBeenCalled();
});
