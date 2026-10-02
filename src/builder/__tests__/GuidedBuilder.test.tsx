import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type React from 'react';
import { Alert } from 'react-native';

import { GuidedBuilder } from '@/builder/GuidedBuilder';
import { InstructorBuilder } from '@/builder/InstructorBuilder';
import { defaultInstructorSettings, proposeClass } from '@/soundtrack/instructor';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunningClass } from '@/builder/RunningClass';
import { MiniPlayer } from '@/playback/MiniPlayer';
import { buildSoundtrack, guidedState, newPlan } from '@/soundtrack/guided';
import { type ClassSoundtrack, parseSoundtrack, updateCue } from '@/soundtrack/model';
import { applyTemplate, TEMPLATES } from '@/soundtrack/templates';

// ---------------------------------------------------------------- mocks

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockPathname = '/';
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    usePathname: () => mockPathname,
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => React.useEffect(() => cb(), [cb]),
  };
});
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock('@/auth/session', () => ({ useSession: () => ({ ready: true, session: { user: { id: 'user-1' } } }) }));
jest.mock('@/data/gyms', () => ({ listMyGyms: jest.fn(async () => ({ gyms: [{ id: 'gym-1' }], error: null })) }));
jest.mock('@/music/client', () => ({ getPlaybackUrl: jest.fn(async () => ({ ok: true, data: { url: 'https://signed/x', expiresInSeconds: 60 } })), fetchCapabilities: jest.fn(async () => ({ ok: false, error: 'network' })), createGeneration: jest.fn(), getGeneration: jest.fn(), describeError: (s: string) => s, TERMINAL: ['READY', 'PARTIAL', 'FAILED'] }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ replace: jest.fn(), play: jest.fn(), pause: jest.fn() }),
  useAudioPlayerStatus: () => ({ playing: false }),
}));
const LIBRARY = [
  { trackId: 'song-a', title: 'Pad Work', durationSeconds: 200, jobId: 'j', label: 'A', style: 'driving electronic' },
  { trackId: 'song-b', title: 'Long Run', durationSeconds: 1000, jobId: 'j', label: 'B' },
];
jest.mock('@/audiolab/assets', () => ({ listPlayable: jest.fn(async () => LIBRARY), cueSeconds: () => 1.5 }));

/** In-memory class_soundtracks table; documents round-trip through JSON like jsonb. */
const mockDb = new Map<string, { doc: unknown; revision: number }>();
let mockSeq = 0;
jest.mock('@/data/soundtracks', () => {
  const { parseSoundtrack: parse } = jest.requireActual('@/soundtrack/model');
  return {
    createSoundtrack: jest.fn(async (_gym: string, _uid: string, s: unknown) => {
      const id = `cls-${++mockSeq}`;
      mockDb.set(id, { doc: JSON.parse(JSON.stringify(s)), revision: 1 });
      return { id, revision: 1, error: null };
    }),
    saveSoundtrack: jest.fn(async (id: string, rev: number, s: unknown) => {
      const row = mockDb.get(id)!;
      if (row.revision !== rev) return { revision: null, error: 'stale' };
      mockDb.set(id, { doc: JSON.parse(JSON.stringify(s)), revision: rev + 1 });
      return { revision: rev + 1, error: null };
    }),
    loadSoundtrack: jest.fn(async (id: string) => {
      const row = mockDb.get(id);
      if (!row) return { value: null, error: 'not found' };
      const p = parse(row.doc);
      return p.ok ? { value: { id, gymId: 'gym-1', name: p.value.name, durationSeconds: p.value.durationSeconds, revision: row.revision, updatedAt: '', soundtrack: p.value }, error: null } : { value: null, error: p.error };
    }),
  };
});

const mockPlayback = { soundtrackId: null as string | null, title: '', sections: [] as unknown[], totalSeconds: 0, engineKind: 'media-player', preparing: false, snapshot: null as unknown, message: null as string | null };
jest.mock('@/playback/session', () => ({
  useClassPlayback: () => mockPlayback,
  isClassActive: (s: { preparing: boolean; snapshot: { state: string } | null }) => s.preparing || (s.snapshot !== null && s.snapshot.state !== 'IDLE'),
  startClass: jest.fn(async () => undefined),
  stopClass: jest.fn(async () => 0),
  togglePlay: jest.fn(),
  seekBy: jest.fn(),
  seekTo: jest.fn(),
}));
type Mocks<K extends string> = Record<K, jest.Mock>;
const session = jest.requireMock('@/playback/session') as Mocks<'startClass' | 'stopClass' | 'togglePlay' | 'seekBy' | 'seekTo'>;
const data = jest.requireMock('@/data/soundtracks') as Mocks<'createSoundtrack' | 'saveSoundtrack' | 'loadSoundtrack'>;

/** Press the Alert button with this text. */
function answerAlert(text: string) {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
    buttons?.find((b) => b.text === text)?.onPress?.();
  });
}

/** Render and let the screen's initial loads (gym, music, stored class) settle. */
async function renderSettled(ui: React.ReactElement) {
  const r = render(ui);
  await act(async () => undefined);
  return r;
}

const stored = (id: string) => {
  const p = parseSoundtrack(mockDb.get(id)!.doc);
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSeq = 0;
  mockDb.clear();
  mockPathname = '/';
  Object.assign(mockPlayback, { soundtrackId: null, snapshot: null, preparing: false, message: null, sections: [] });
});

describe('Instructor setup', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('allows changing class length before fixing rounds, and restores the current step', async () => {
    await AsyncStorage.setItem('instructor-class:v1:user-1:gym-1', JSON.stringify({ version: 1, settings: { ...defaultInstructorSettings(), timed: true, rounds: 8 } }));
    const first = await renderSettled(<InstructorBuilder />);
    expect(screen.queryByLabelText('Warm-up minutes')).toBeNull();
    fireEvent.press(screen.getByText('Custom length'));
    fireEvent.changeText(screen.getByLabelText('Class length in minutes'), '15');
    fireEvent.press(screen.getByTestId('ic-next'));
    expect(screen.getByText('2 of 4 · Timing')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ic-next'));
    expect(screen.getByText(/These rounds are longer/)).toBeTruthy();
    fireEvent.press(screen.getByText('Continuous practice'));
    await act(async () => { fireEvent.press(screen.getByTestId('ic-next')); });
    first.unmount();
    await renderSettled(<InstructorBuilder />);
    expect(screen.getByText('3 of 4 · Cues')).toBeTruthy();
    fireEvent.press(screen.getByText('Add a cue or spoken instruction'));
    fireEvent.press(screen.getByTestId('ic-next'));
    expect(screen.getByText(/Enter a spoken instruction/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Spoken instruction 1'), 'Breathe');
    fireEvent.press(screen.getByTestId('ic-next'));
    expect(screen.getByText('4 of 4 · Music')).toBeTruthy();
  });

  it('keeps every editor available from a simple Preview and opens the selected section music', async () => {
    await renderSettled(<GuidedBuilder initialPlan={proposeClass(defaultInstructorSettings())} initialLibrary={LIBRARY} />);
    expect(screen.queryByTestId('gb-step-0')).toBeNull();
    fireEvent.press(screen.getByLabelText('Change music for Cooldown'));
    expect(screen.getByText('Music for Cooldown')).toBeTruthy();
    fireEvent.press(screen.getByTestId('picker-close'));
    fireEvent.press(screen.getByTestId('gb-edit-1'));
    fireEvent.press(screen.getByTestId('gb-section-0-minutes-minus'));
    expect(screen.getByText('Done · Back to Preview')).toBeDisabled();
    fireEvent.press(screen.getByTestId('gb-fix-extend'));
    fireEvent.press(screen.getByText('Done · Back to Preview'));
    for (const index of [0, 2, 3]) {
      fireEvent.press(screen.getByTestId(`gb-edit-${index}`));
      fireEvent.press(screen.getByText('Done · Back to Preview'));
    }
    fireEvent.press(screen.getByText('More class options'));
    expect(screen.getByTestId('gb-advanced')).toBeTruthy();
  });

  it('shows live Step 4 progress, preserves it on pause, and resumes the same job into Preview', async () => {
    jest.useFakeTimers();
    const music = jest.requireMock('@/music/client');
    const settings = { ...defaultInstructorSettings(), source: 'generate', minutes: 5, warmup: 0, cooldown: 0 };
    const job = (id: string, state: string, seconds?: number) => ({ ok: true, data: { id, state, errorCode: null, createdAt: new Date().toISOString(), candidates: seconds ? [{ id: `track-${id}`, title: 'Generated music', label: 'A', playable: true, status: 'ready', durationSeconds: seconds }] : [] } });
    music.fetchCapabilities.mockResolvedValue({ ok: true, data: { customLyrics: { supported: true }, descriptionMode: { supported: true }, instrumental: true, styleTags: { supported: true }, negativeTags: { supported: false }, models: [], defaultModel: 'default', targetDuration: { supported: true, maxSeconds: 120 }, candidatesPerJob: 2 } });
    music.createGeneration.mockResolvedValueOnce(job('first', 'QUEUED')).mockResolvedValueOnce(job('second', 'QUEUED'));
    music.getGeneration.mockResolvedValueOnce(job('first', 'RENDERING')).mockResolvedValueOnce(job('first', 'READY', 100)).mockResolvedValueOnce(job('second', 'READY', 200));
    try {
      await AsyncStorage.setItem('instructor-class:v1:user-1:gym-1', JSON.stringify({ version: 1, settings }));
      const first = await renderSettled(<InstructorBuilder />);
      for (let i = 0; i < 3; i++) fireEvent.press(screen.getByTestId('ic-next'));
      await act(async () => { fireEvent.press(screen.getByTestId('ic-build')); });
      expect(screen.getByText('Waiting for music to start')).toBeTruthy();
      expect(screen.getByTestId('class-coverage').props.accessibilityValue.now).toBe(0);
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.getByText('Generating music')).toBeTruthy();
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.getByTestId('class-coverage').props.accessibilityValue.now).toBe(33);
      expect(music.createGeneration).toHaveBeenCalledTimes(2);
      fireEvent.press(screen.getByText('Pause after current request'));
      expect(screen.getByText('Pausing after the current request')).toBeTruthy();
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.getByText('Creation paused')).toBeTruthy();
      expect(screen.queryByTestId('class-creation-spinner')).toBeNull();
      first.unmount();
      await renderSettled(<InstructorBuilder />);
      expect(screen.getByTestId('class-coverage').props.accessibilityValue.now).toBe(33);
      await act(async () => { fireEvent.press(screen.getByTestId('ic-build')); });
      expect(screen.getByTestId('gb-title')).toHaveTextContent('Preview');
      expect(music.createGeneration).toHaveBeenCalledTimes(2);
      expect(music.getGeneration).toHaveBeenLastCalledWith('second');
    } finally {
      music.fetchCapabilities.mockResolvedValue({ ok: false, error: 'network' });
      jest.useRealTimers();
    }
  });

  it('builds, saves and starts a real 60-minute plan from instructor answers', async () => {
    await renderSettled(<InstructorBuilder />);
    fireEvent.changeText(screen.getByTestId('ic-name'), 'Evening practice');
    fireEvent.press(screen.getByTestId('ic-next'));
    fireEvent.press(screen.getByText('Timed rounds'));
    fireEvent.changeText(screen.getByLabelText('Number of rounds'), '8');
    fireEvent.press(screen.getByTestId('ic-next'));
    fireEvent.press(screen.getByText('Add a cue or spoken instruction'));
    fireEvent.changeText(screen.getByLabelText('Spoken instruction 1'), 'Keep your breathing steady');
    fireEvent.press(screen.getByText('Customize cue timing and location'));
    fireEvent.press(screen.getByText('During each work round'));
    fireEvent.press(screen.getByTestId('ic-next'));
    fireEvent.press(screen.getByText(/Pad Work ·/));
    fireEvent.press(screen.getByText('Allow repeats'));
    await act(async () => { fireEvent.press(screen.getByTestId('ic-build')); });
    expect(screen.getByTestId('gb-class-heading')).toHaveTextContent('60 MIN EVENING PRACTICE');
    fireEvent.press(screen.getByText('Music only'));
    await act(async () => { fireEvent.press(screen.getByTestId('gb-save')); });
    const id = data.createSoundtrack.mock.results.at(-1)!.value;
    const result = await id;
    const doc = stored(result.id);
    expect(doc.cuesEnabled).toBe(false);
    expect(doc.cues.some(c => c.speechText === 'Keep your breathing steady')).toBe(true);
    expect(doc.durationSeconds).toBe(3600);
    expect(doc.tracks.length).toBeGreaterThan(10);
    expect(await AsyncStorage.getItem('instructor-class:v1:user-1:gym-1')).toBeNull();
    fireEvent.press(screen.getByText('With cues'));
    await act(async () => { fireEvent.press(screen.getByTestId('gb-start')); });
    expect(session.startClass).toHaveBeenCalledWith(expect.objectContaining({ title: 'Evening practice', plan: expect.objectContaining({ totalSeconds: 3600, cues: expect.any(Array) }) }));
    expect(stored(result.id).cuesEnabled).toBe(true);
  }, 30000);

  it('restores a draft and duplicates without changing the saved original', async () => {
    const first = await renderSettled(<InstructorBuilder />);
    await act(async () => { fireEvent.changeText(screen.getByTestId('ic-name'), 'Reusable practice'); });
    first.unmount();
    await renderSettled(<InstructorBuilder />);
    expect(screen.getByTestId('ic-name')).toHaveProp('value', 'Reusable practice');
    fireEvent.press(screen.getByTestId('ic-next'));
    fireEvent.press(screen.getByTestId('ic-next'));
    fireEvent.press(screen.getByTestId('ic-next'));
    fireEvent.press(screen.getByText(/Long Run ·/));
    fireEvent.press(screen.getByText('Allow repeats'));
    await act(async () => { fireEvent.press(screen.getByTestId('ic-build')); });
    await act(async () => { fireEvent.press(screen.getByTestId('gb-save')); });
    const original = [...mockDb.keys()][0]!;
    const originalDoc = JSON.stringify(stored(original));
    fireEvent.press(screen.getByText('More class options'));
    fireEvent.press(screen.getByText('Duplicate class'));
    await act(async () => { fireEvent.press(screen.getByTestId('gb-save')); });
    expect(mockDb.size).toBe(2);
    expect(JSON.stringify(stored(original))).toBe(originalDoc);
    expect([...mockDb.keys()].filter(id => id !== original).map(id => stored(id).name)).toEqual(['Reusable practice copy']);
  });
});

// ---------------------------------------------------------------- guided flow

describe('Guided Builder', () => {
  // The whole guided flow in one test. It is also the first render of the screen, so it carries the
  // cold-start cost (~5 s on a cold cache): give it room instead of Jest's 5 s default.
  it('builds a 60 minute class from scratch: sections, durations, reorder, music, cues, preview, save, start', async () => {
    await renderSettled(<GuidedBuilder />);
    expect(data.loadSoundtrack).not.toHaveBeenCalled();

    // 1. Class
    expect(screen.getByTestId('gb-title')).toHaveTextContent('Create class soundtrack');
    expect(screen.getByTestId('gb-continue')).toHaveTextContent('Continue to Sections');
    expect(screen.queryByText(/timeline|offset|engine/i)).toBeNull();
    fireEvent.changeText(screen.getByTestId('gb-name'), 'Tuesday Fundamentals');
    fireEvent.press(screen.getByTestId('gb-length-60'));
    fireEvent.press(screen.getByTestId('gb-continue'));

    // 2. Sections
    expect(screen.getByTestId('gb-title')).toHaveTextContent('Sections');
    expect(screen.getByTestId('gb-continue')).toBeDisabled();
    for (const k of ['warmup', 'technique', 'drilling', 'rounds', 'cooldown']) fireEvent.press(screen.getByTestId(`gb-add-${k}`));
    expect(screen.getByTestId('gb-total')).toHaveTextContent('Total: 60 / 60 minutes');
    expect(screen.getByTestId('gb-continue')).toBeEnabled();

    // change durations: warm-up 10 -> 8, the total shows it and offers a fix
    fireEvent.press(screen.getByTestId('gb-section-0-minutes-minus'));
    fireEvent.press(screen.getByTestId('gb-section-0-minutes-minus'));
    expect(screen.getByTestId('gb-section-0-minutes-value')).toHaveTextContent('8 MIN');
    expect(screen.getByTestId('gb-total')).toHaveTextContent('Total: 58 / 60 minutes');
    expect(screen.getByTestId('gb-continue')).toBeDisabled();
    fireEvent.press(screen.getByTestId('gb-fix-extend')); // +2 min to Cooldown
    expect(screen.getByTestId('gb-total')).toHaveTextContent('Total: 60 / 60 minutes');

    // reorder: Drilling before Technique
    fireEvent.press(screen.getByTestId('gb-section-2-up'));
    expect(within(screen.getByTestId('gb-section-1')).getByText('Drilling')).toBeTruthy();
    expect(within(screen.getByTestId('gb-section-2')).getByText('Technique')).toBeTruthy();
    fireEvent.press(screen.getByTestId('gb-continue'));

    // 3. Music: choose a 3:20 song for the 8 min warm-up; it doesn't fill, so Cadence asks
    expect(screen.getByTestId('gb-title')).toHaveTextContent('Music');
    fireEvent.press(screen.getByTestId('gb-music-0-choose'));
    expect(await screen.findByText('GENERATE MUSIC FOR THIS SECTION')).toBeTruthy();
    expect(screen.getByText(/driving electronic/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('picker-play-song-a')); // preview
    fireEvent.press(screen.getByTestId('picker-choose-song-a'));
    expect(screen.getByTestId('gb-music-0-status')).toHaveTextContent('Music covers 3:20 of 8 min. 4:40 left.');
    fireEvent.press(screen.getByTestId('gb-music-0-fill-repeat'));
    expect(screen.getByTestId('gb-music-0-status')).toHaveTextContent('Your songs repeat to fill 8 min.');
    // Drilling (15 min) gets a long song: it fills and the cut is stated
    fireEvent.press(screen.getByTestId('gb-music-1-choose'));
    fireEvent.press(await screen.findByTestId('picker-choose-song-b'));
    expect(screen.getByTestId('gb-music-1-status')).toHaveTextContent('Music fills the section. The last song ends 1:40 early and fades out.');
    fireEvent.press(screen.getByTestId('gb-music-3-intensity-5'));
    fireEvent.press(screen.getByTestId('gb-continue'));

    // 4. Cues: a section cue, and repeating round cues
    expect(screen.getByTestId('gb-title')).toHaveTextContent('Cues');
    fireEvent.press(screen.getByTestId('gb-cues-1-add'));
    fireEvent.press(screen.getByTestId('cue-kind-switch'));
    expect(screen.getByTestId('cue-summary')).toHaveTextContent('Every 2 min · plays 7 times');
    fireEvent.press(screen.getByTestId('cue-seconds-plus')); // every 2:30
    expect(screen.getByTestId('cue-summary')).toHaveTextContent('Every 2:30 · plays 5 times');
    fireEvent.press(screen.getByTestId('cue-importance-optional'));
    fireEvent.press(screen.getByTestId('cue-done'));
    expect(screen.getByTestId('gb-cues-1-rule-0')).toHaveTextContent(/Switch partners.*Every 2:30 · 5 times/);

    // Rounds: defaults 3 min on / 1 min rest; ask for 5 rounds -> too long for 15 min -> fit
    const rounds = screen.getByTestId('gb-cues-3');
    expect(within(rounds).getByTestId('gb-cues-3-rounds-summary')).toHaveTextContent('4 rounds take 15 min of 15 min.');
    fireEvent.press(within(rounds).getByTestId('gb-cues-3-count-plus'));
    expect(within(rounds).getByTestId('gb-cues-3-rounds-summary')).toHaveTextContent('5 rounds take 19 min, but this section is 15 min. 4 fit.');
    fireEvent.press(within(rounds).getByTestId('gb-cues-3-fit'));
    expect(within(rounds).getByTestId('gb-cues-3-rule-0')).toHaveTextContent(/Round start.*4 times/);
    fireEvent.press(within(rounds).getByTestId('gb-cues-3-add'));
    fireEvent.press(screen.getByTestId('cue-kind-thirty'));
    expect(screen.getByTestId('cue-summary')).toHaveTextContent('30 sec before each round ends · plays 4 times');
    fireEvent.press(screen.getByTestId('cue-done'));
    // A custom cue with its own name and sound
    fireEvent.press(screen.getByTestId('gb-cues-0-add'));
    fireEvent.press(screen.getByTestId('cue-kind-custom'));
    fireEvent.changeText(screen.getByTestId('cue-name'), 'Water break');
    fireEvent.press(screen.getByTestId('cue-when-before_section_end'));
    fireEvent.press(screen.getByTestId('cue-sound-stop'));
    fireEvent.press(screen.getByTestId('cue-done'));
    fireEvent.press(screen.getByTestId('gb-continue'));

    // 5. Overview
    expect(screen.getByTestId('gb-title')).toHaveTextContent('Preview');
    expect(screen.getByTestId('gb-overview-0')).toHaveTextContent(/Warm-up.*1 song · 1 cue · Music repeats.*8 min/);
    expect(screen.getByTestId('gb-overview-3')).toHaveTextContent(/Rounds.*0 songs · 3 cues · No music.*15 min/);

    // Preview saves the new class first (it needs an id to play) and plays the compiled plan
    await act(async () => fireEvent.press(screen.getByTestId('gb-preview')));
    expect(data.createSoundtrack).toHaveBeenCalledTimes(1);
    expect(session.startClass).toHaveBeenCalledTimes(1);
    const started = session.startClass.mock.calls[0]![0];
    expect(started).toMatchObject({ soundtrackId: 'cls-1', title: 'Tuesday Fundamentals', fromSeconds: 0 });
    expect(started.plan.totalSeconds).toBe(3600);
    // Round start: 4 rounds from 38:00 (Rounds moved after the reorder), every 4 min
    expect(started.plan.cues.filter((c: { assetId: string }) => c.assetId === 'round').map((c: { timeSeconds: number }) => c.timeSeconds)).toEqual([2280, 2520, 2760, 3000]);

    const doc = stored('cls-1');
    expect(doc.sections.map((s) => [s.label, s.startSeconds, s.endSeconds])).toEqual([
      ['Warm-up', 0, 480],
      ['Drilling', 480, 1380],
      ['Technique', 1380, 2280],
      ['Rounds', 2280, 3180],
      ['Cooldown', 3180, 3600],
    ]);
    expect(guidedState(doc).diverged).toBe(false);
    // Warm-up repeats the 200 s song to fill 480 s, never stretching it
    expect(doc.tracks.filter((t) => t.startSeconds < 480).map((t) => [t.assetId, t.startSeconds, t.durationSeconds])).toEqual([
      ['song-a', 0, 200],
      ['song-a', 200, 200],
      ['song-a', 400, 80],
    ]);
    expect(doc.cues.find((c) => c.label === 'Water break')).toMatchObject({ type: 'stop', timeSeconds: 450 });
    expect(doc.cues.find((c) => c.label === 'Switch partners')).toMatchObject({ priority: 'low', repeatEverySeconds: 150 });

    // Save after a change updates the same row with its revision
    fireEvent.press(screen.getByTestId('gb-step-0'));
    fireEvent.changeText(screen.getByTestId('gb-name'), 'Tuesday Fundamentals v2');
    fireEvent.press(screen.getByTestId('gb-step-4'));
    await act(async () => fireEvent.press(screen.getByTestId('gb-save')));
    expect(data.saveSoundtrack).toHaveBeenCalledWith('cls-1', 1, expect.objectContaining({ name: 'Tuesday Fundamentals v2' }));
    expect(stored('cls-1').name).toBe('Tuesday Fundamentals v2');

    // Start class opens the running view
    await act(async () => fireEvent.press(screen.getByTestId('gb-start')));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/soundtracks/[id]/run', params: { id: 'cls-1' } });
  }, 30_000);

  it('builds from a template, scaled to the class length', async () => {
    await renderSettled(<GuidedBuilder />);
    fireEvent.press(screen.getByTestId('gb-length-45'));
    fireEvent.press(screen.getByTestId('gb-continue'));
    expect(within(screen.getByTestId('gb-template-standard60')).getByText(/60 min, fitted to 45 min/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('gb-template-standard60'));
    expect(screen.getByTestId('gb-total')).toHaveTextContent('Total: 45 / 45 minutes');
    // Replacing existing sections asks first
    fireEvent.press(screen.getByTestId('gb-show-templates'));
    answerAlert('Replace');
    fireEvent.press(screen.getByTestId('gb-template-openmat'));
    expect(screen.getByTestId('gb-section-1')).toHaveTextContent(/Rounds/);
    expect(screen.queryByTestId('gb-section-3')).toBeNull();
    expect(screen.getByTestId('gb-total')).toHaveTextContent('Total: 45 / 45 minutes');
  });

  it('Generate music for this section carries the section context to the generator', async () => {
    await renderSettled(<GuidedBuilder />);
    fireEvent.press(screen.getByTestId('gb-continue'));
    fireEvent.press(screen.getByTestId('gb-add-rounds'));
    fireEvent.press(screen.getByTestId('gb-fix-extend'));
    fireEvent.press(screen.getByTestId('gb-continue'));
    fireEvent.press(screen.getByTestId('gb-music-0-intensity-4'));
    fireEvent.press(screen.getByTestId('gb-music-0-choose'));
    fireEvent.press(await screen.findByTestId('picker-generate'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/generator',
      params: { description: 'Music for the rounds part of a martial arts class, hard intensity, about 60 min', style: 'intense, high energy', seconds: '3600' },
    });
  });

  it('reopens a saved class on its overview, and opens Advanced edit', async () => {
    const plan = newPlan(60);
    plan.sections = applyTemplate(TEMPLATES[0]!, 60);
    mockDb.set('cls-9', { doc: JSON.parse(JSON.stringify(buildSoundtrack({ name: 'Saved class', musicGain: 1 }, plan))), revision: 3 });
    await renderSettled(<GuidedBuilder id="cls-9" />);
    expect(await screen.findByTestId('gb-class-heading')).toHaveTextContent('60 MIN SAVED CLASS');
    expect(screen.getByTestId('gb-title')).toHaveTextContent('Preview');
    expect(screen.getByTestId('gb-overview-3')).toHaveTextContent(/Rounds.*2 cues/);
    expect(screen.queryByTestId('gb-diverged')).toBeNull();
    // Edit a section directly from the overview
    fireEvent.press(screen.getByTestId('gb-step-1'));
    expect(screen.getByTestId('gb-total')).toHaveTextContent('Total: 60 / 60 minutes');
    fireEvent.press(screen.getByTestId('gb-step-4'));
    await act(async () => fireEvent.press(screen.getByTestId('gb-advanced')));
    expect(data.saveSoundtrack).not.toHaveBeenCalled(); // nothing to save
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/soundtracks/[id]/advanced', params: { id: 'cls-9' } });
  });

  it('says so when a class was changed in Advanced edit, and only rebuilds when asked', async () => {
    const plan = newPlan(60);
    plan.sections = applyTemplate(TEMPLATES[0]!, 60);
    const built = buildSoundtrack({ name: 'Edited', musicGain: 1 }, plan);
    const edited: ClassSoundtrack = updateCue(built, built.cues[0]!.id, { timeSeconds: built.cues[0]!.timeSeconds + 7 });
    mockDb.set('cls-7', { doc: JSON.parse(JSON.stringify(edited)), revision: 2 });
    await renderSettled(<GuidedBuilder id="cls-7" />);
    expect(await screen.findByTestId('gb-diverged')).toBeTruthy();
    expect(screen.getByTestId('gb-step-1')).toBeDisabled();
    // Previewing plays the class exactly as edited
    await act(async () => fireEvent.press(screen.getByTestId('gb-preview')));
    const cues = session.startClass.mock.calls[0]![0].plan.cues as { timeSeconds: number }[];
    expect(cues.some((c) => c.timeSeconds === built.cues[0]!.timeSeconds + 7)).toBe(true);
    answerAlert('Rebuild');
    fireEvent.press(screen.getByTestId('gb-rebuild'));
    expect(screen.queryByTestId('gb-diverged')).toBeNull();
    expect(screen.getByTestId('gb-step-1')).toBeEnabled();
  });

  it('asks before leaving with unsaved changes', async () => {
    await renderSettled(<GuidedBuilder />);
    fireEvent.changeText(screen.getByTestId('gb-name'), 'x');
    answerAlert('Keep editing');
    fireEvent.press(screen.getByTestId('gb-leave'));
    expect(mockRouter.back).not.toHaveBeenCalled();
    answerAlert('Discard');
    fireEvent.press(screen.getByTestId('gb-leave'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- running view and returning to a class

describe('Running view', () => {
  function savedClass() {
    const plan = newPlan(60);
    plan.sections = applyTemplate(TEMPLATES[0]!, 60);
    plan.sections[3] = { ...plan.sections[3]!, music: [{ assetId: 'song-b', label: 'Long Run', durationSeconds: 1000 }] };
    mockDb.set('cls-5', { doc: JSON.parse(JSON.stringify(buildSoundtrack({ name: 'Monday', musicGain: 1 }, plan))), revision: 1 });
  }

  it('shows section, time left, current music, next cue and next section, with big controls', async () => {
    savedClass();
    Object.assign(mockPlayback, { soundtrackId: 'cls-5', snapshot: { state: 'PLAYING', positionSeconds: 2450, currentTrackIds: [], nextCueKey: null, lastError: null, route: null } });
    await renderSettled(<RunningClass id="cls-5" />);
    expect(await screen.findByTestId('run-section')).toHaveTextContent('Rounds');
    expect(screen.getByTestId('run-remaining')).toHaveTextContent('14:10'); // Rounds ends at 55:00
    expect(screen.getByTestId('run-track')).toHaveTextContent('Long Run');
    expect(screen.getByTestId('run-cue')).toHaveTextContent('Round end in 2:10'); // 3 min round from 40:00
    expect(screen.getByTestId('run-next')).toHaveTextContent('Cooldown in 14:10');
    expect(screen.getByText('PAUSE')).toBeTruthy();
    fireEvent.press(screen.getByTestId('run-toggle'));
    expect(session.togglePlay).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('run-back30'));
    expect(session.seekBy).toHaveBeenCalledWith(-30);
    fireEvent.press(screen.getByTestId('run-fwd30'));
    expect(session.seekBy).toHaveBeenCalledWith(30);
    fireEvent.press(screen.getByTestId('run-next-section'));
    expect(session.seekTo).toHaveBeenCalledWith(3300);
    expect(jest.requireMock('expo-keep-awake').activateKeepAwakeAsync).toHaveBeenCalledWith('class-cls-5');
  });

  it('starts a class that is not playing yet', async () => {
    savedClass();
    await renderSettled(<RunningClass id="cls-5" />);
    const startButton = await screen.findByTestId('run-start');
    await act(async () => fireEvent.press(startButton));
    expect(session.startClass).toHaveBeenCalledWith(expect.objectContaining({ soundtrackId: 'cls-5', fromSeconds: 0, engineKind: 'media-player' }));
  });

  it('the mini-player returns to the running class from anywhere, and hides on the running view itself', () => {
    Object.assign(mockPlayback, { soundtrackId: 'cls-5', title: 'Monday', totalSeconds: 3600, snapshot: { state: 'PLAYING', positionSeconds: 100 } });
    mockPathname = '/library';
    const { unmount } = render(<MiniPlayer />);
    fireEvent.press(screen.getByLabelText('Open the class view'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/soundtracks/[id]/run', params: { id: 'cls-5' } });
    unmount();
    mockPathname = '/soundtracks/cls-5/run';
    render(<MiniPlayer />);
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });
});
