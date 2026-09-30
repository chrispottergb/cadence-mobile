import * as Speech from 'expo-speech';
import { PlayerEngine } from '../playerEngine';
import { speechAsset } from '@/soundtrack/speech';
import type { CueEvent, PlacedTrack } from '../timeline';

const mockPlayers: { currentTime: number; volume: number; pause: jest.Mock; remove: jest.Mock }[] = [];
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => {}), createAudioPlayer: () => {
  const player = { currentTime: 0, volume: 1, playing: true, seekTo: jest.fn(async (t: number) => { player.currentTime = t; }), play: jest.fn(), pause: jest.fn(), remove: jest.fn(), setActiveForLockScreen: jest.fn() };
  mockPlayers.push(player); return player;
} }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => {}) }));
jest.mock('../metrics', () => ({ record: jest.fn() }));
const cue: CueEvent = { key: 'voice@0', cueId: 'voice', timeSeconds: 0, assetId: speechAsset('Switch partners'), durationSeconds: 2, priority: 'normal', duckTo: 0.2 };
const placed: PlacedTrack = { index: 0, trackId: 'music', startSeconds: 0, endSeconds: 60, sourceOffsetSeconds: 0, playSeconds: 60, gain: 1, crossfadeInSeconds: 0, crossfadeOutSeconds: 0 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockPlayers.length = 0; });
afterEach(() => jest.useRealTimers());

it('speaks actual text, holds ducking until speech completes, and cancels on pause', async () => {
  const e = new PlayerEngine();
  await e.load([placed], [{ trackId: 'music', source: 'music.mp3', durationSeconds: 60 }], [cue], [], 60);
  await e.play(); jest.advanceTimersByTime(20); await flush();
  expect(Speech.speak).toHaveBeenCalledWith('Switch partners', expect.objectContaining({ useApplicationAudioSession: true }));
  mockPlayers[0]!.currentTime = 2.5;
  jest.advanceTimersByTime(2500); await flush();
  expect(mockPlayers[0]!.volume).toBe(0.2);
  const options = jest.mocked(Speech.speak).mock.calls[0]![1]!;
  await e.pause();
  expect(Speech.stop).toHaveBeenCalledTimes(1);
  expect(mockPlayers[0]!.pause).toHaveBeenCalled();
  options.onDone?.(); // stale completion must not revive playback
  expect(e.snapshot().state).toBe('PAUSED');
  await e.dispose();
});

it('seeking past speech cancels it and does not replay skipped instructions', async () => {
  const e = new PlayerEngine();
  await e.load([placed], [{ trackId: 'music', source: 'music.mp3', durationSeconds: 60 }], [cue], []);
  await e.play(); jest.advanceTimersByTime(20); await flush();
  await e.seek(30); jest.advanceTimersByTime(20); await flush();
  expect(Speech.stop).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(e.snapshot().positionSeconds).toBe(30);
  await e.dispose();
});

it('advances through intentional quiet time and ends at class length', async () => {
  const e = new PlayerEngine();
  await e.load([], [], [{ ...cue, timeSeconds: 5, key: 'voice@5' }], [], 10);
  await e.play(); jest.advanceTimersByTime(5000); await flush();
  expect(e.snapshot().positionSeconds).toBe(5);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(5000); await flush();
  expect(e.snapshot().state).toBe('COMPLETED');
  expect(e.snapshot().positionSeconds).toBe(10);
  await e.dispose();
});

it('disposal prevents a queued cue from sounding', async () => {
  const e = new PlayerEngine();
  await e.load([], [], [cue], [], 10);
  await e.play(); jest.advanceTimersByTime(20);
  await e.dispose(); await flush();
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
