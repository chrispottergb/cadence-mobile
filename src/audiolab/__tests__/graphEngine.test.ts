/**
 * Graph engine scheduling under seeks. The native audio library is replaced
 * by a fake whose decodes resolve only when the test says so, so a seek can
 * land while a decode is still in flight (the Stage A build 113 failure:
 * every +60 s left an orphaned track playing on top of the new position).
 */
import { GraphEngine } from '../graphEngine';
import { placeTracks } from '../timeline';

type Resolver = () => void;
const mockPendingDecodes: Resolver[] = [];
const mockStarted: { id: number; when: number; offset: number; stopped: boolean }[] = [];
let mockNextId = 0;
let mockClock = 0;

class MockParam {
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class MockGain {
  gain = new MockParam();
  connect() {}
}
class MockSource {
  buffer: unknown = null;
  onEnded: (() => void) | null = null;
  private rec: (typeof mockStarted)[number] | null = null;
  connect() {}
  start(when: number, offset = 0) {
    this.rec = { id: mockNextId++, when, offset, stopped: false };
    mockStarted.push(this.rec);
  }
  stop() {
    if (this.rec) this.rec.stopped = true;
  }
}
class MockContext {
  sampleRate = 48000;
  destination = {};
  get currentTime() {
    return mockClock;
  }
  createGain() {
    return new MockGain();
  }
  createBufferSource() {
    return new MockSource();
  }
  decodeAudioData(src: string) {
    const seconds = src.startsWith('cue') ? 1 : 120;
    return new Promise((resolve) => mockPendingDecodes.push(() => resolve({ duration: seconds, length: seconds * 48000, numberOfChannels: 2 })));
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

jest.mock('react-native-audio-api', () => ({
  // Looked up lazily: imports are hoisted above the class declarations.
  get AudioContext() {
    return MockContext;
  },
  AudioManager: { setAudioSessionOptions: jest.fn(), observeAudioInterruptions: jest.fn() },
  PlaybackNotificationManager: { show: jest.fn(() => Promise.resolve()), hide: jest.fn(() => Promise.resolve()) },
}));
jest.mock(
  'react-native-audio-api/lib/module/events',
  () => ({
    AudioEventEmitter: class {
      addAudioEventListener() {
        return { remove() {} };
      }
    },
  }),
  { virtual: true },
);


const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function settle() {
  // Resolve every decode as it appears, letting awaiting code run in between.
  for (let i = 0; i < 50; i++) {
    await flush();
    const r = mockPendingDecodes.shift();
    if (!r) {
      await flush();
      if (!mockPendingDecodes.length) return;
      continue;
    }
    r();
  }
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockPendingDecodes.length = 0;
  mockStarted.length = 0;
  mockNextId = 0;
  mockClock = 0;
});

const engines: GraphEngine[] = [];
afterEach(async () => {
  // Stop each engine's window timer so Jest can exit.
  await Promise.all(engines.splice(0).map((e) => e.dispose()));
});

async function loaded() {
  const e = new GraphEngine();
  engines.push(e);
  const placed = placeTracks(
    Array.from({ length: 10 }, (_, i) => ({ trackId: `t${i}`, sourceDurationSeconds: 120, crossfadeInSeconds: 0 })),
  );
  const tracks = placed.map((p) => ({ trackId: p.trackId, source: `file:///${p.trackId}.mp3`, durationSeconds: 120 }));
  const load = e.load(placed, tracks, [], []);
  await settle();
  await load;
  return e;
}

const audible = () => mockStarted.filter((s) => !s.stopped);

describe('GraphEngine rolling window', () => {
  it('holds only the tracks near the playhead, not the whole class', async () => {
    const e = await loaded();
    const play = e.play(0);
    await settle();
    await play;
    expect(audible().length).toBe(1);
  });

  it('rapid seeks while a decode is in flight leave exactly one track sounding', async () => {
    const e = await loaded();
    const play = e.play(0);
    await settle();
    await play;
    // Three +60 s taps in quick succession, each landing before decodes resolve.
    const seeks = [e.seek(60), e.seek(120), e.seek(180)];
    await new Promise((r) => setTimeout(r, 300)); // seek settle window
    await settle();
    await Promise.all(seeks);
    await settle();
    const live = audible();
    expect(live.length).toBe(1);
    // The survivor is the track at 180 s (track index 1, 60 s in).
    expect(live[0]!.offset).toBeCloseTo(60, 0);
  });
  it('spamming +60 s runs at most one decode at a time and ends with one track at the final position', async () => {
    const e = await loaded();
    const play = e.play(0);
    await settle();
    await play;
    const seeks: Promise<void>[] = [];
    let target = 0;
    for (let i = 0; i < 10; i++) {
      target += 60;
      seeks.push(e.seek(target));
      // Decodes never pile up: at most one is in flight at any moment.
      expect(mockPendingDecodes.length).toBeLessThanOrEqual(1);
    }
    // Let the seek settle window pass, then drain decodes.
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    await Promise.all(seeks);
    await settle();
    const live = audible();
    expect(live.length).toBe(1);
    // 600 s = track index 5, 0 s in.
    expect(live[0]!.offset).toBeCloseTo(0, 0);
    expect(e.snapshot().positionSeconds).toBeGreaterThanOrEqual(600);
  });
});
