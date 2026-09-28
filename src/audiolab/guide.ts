/**
 * Guided Stage A tests: plain-language steps for the person holding the phone.
 * Each test fixes its own settings so nothing has to be configured by hand.
 */
export type GuideScenario = 'class3' | 'long30' | 'long45';

export interface GuideTest {
  id: string; // also the tag stamped on every measurement
  title: string;
  minutes: string;
  scenario: GuideScenario;
  source: 'download' | 'stream';
  crossfade: number;
  shortLinks: boolean;
  steps: string[];
  marks: string[]; // one-tap notes for this test
}

export const GUIDE: GuideTest[] = [
  {
    id: 'T1 Basic',
    title: 'Basic playback',
    minutes: '5 min',
    scenario: 'class3',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: [
      'Tap Play. Then Pause, then Play again.',
      'Tap +10s once.',
      'Go to the home screen for 30 seconds. Is the music still playing?',
      'Lock the phone for 2 minutes. Unlock and come back here.',
    ],
    marks: ['Locked', 'Unlocked'],
  },
  {
    id: 'T2 Bluetooth',
    title: 'Bluetooth speaker',
    minutes: '5 min',
    scenario: 'class3',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: [
      'Connect the Bluetooth speaker first.',
      'Tap Play and lock the phone.',
      'Turn the speaker OFF for 10 seconds. Where did the sound go?',
      'Turn the speaker back ON. Did it come back by itself?',
    ],
    marks: ['BT off', 'BT on'],
  },
  {
    id: 'T3 Interrupt',
    title: 'Phone call or other app',
    minutes: '3 min',
    scenario: 'class3',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: [
      'Tap Play.',
      'Have someone call you, or play a video in another app.',
      'Come back here. The music should be paused, waiting for you.',
      'Tap Play to continue. Did it pick up where it stopped?',
    ],
    marks: ['Call', 'Other app'],
  },
  {
    id: 'T4 Cues',
    title: 'Bells and voice cues',
    minutes: '4 min',
    scenario: 'class3',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: [
      'Tap Play and just listen.',
      'Tap "Heard cue" every time you hear a bell or a voice.',
      'Halfway through, lock the phone and keep listening.',
      'Did any cue feel late or get cut off?',
    ],
    marks: ['Heard cue', 'Locked'],
  },
  {
    id: 'T5 Ducking',
    title: 'Music dips under the voice',
    minutes: '4 min',
    scenario: 'class3',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: ['Tap Play and listen to the voice cues.', 'The music should get quieter while the voice speaks, then come back smoothly.', 'Any harsh jumps in volume or crackling?'],
    marks: ['Heard cue'],
  },
  {
    id: 'T6 Transitions',
    title: 'Song to song (crossfade)',
    minutes: '6 min',
    scenario: 'class3',
    source: 'download',
    crossfade: 3,
    shortLinks: false,
    steps: ['Tap Play and listen at each song change.', 'The songs should blend over about 3 seconds, with no silence and no double playback.'],
    marks: ['Heard cue'],
  },
  {
    id: 'T7 30 min',
    title: '30-minute class',
    minutes: '30 min',
    scenario: 'long30',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: [
      'Note your battery %.',
      'Tap Play. Use the phone normally: home screen, lock, unlock, Bluetooth.',
      'Pause and resume once somewhere in the middle.',
      'At the end, note your battery % again.',
    ],
    marks: ['Locked', 'Unlocked', 'BT on', 'BT off'],
  },
  {
    id: 'T8 45 min',
    title: '45-minute class',
    minutes: '45 min',
    scenario: 'long45',
    source: 'download',
    crossfade: 0,
    shortLinks: false,
    steps: ['Only if the 30-minute class went fine.', 'Same as the 30-minute class, for 45 minutes.'],
    marks: ['Locked', 'Unlocked', 'BT on', 'BT off'],
  },
  {
    id: 'Links',
    title: 'Streaming link expiry',
    minutes: '4 min',
    scenario: 'class3',
    source: 'stream',
    crossfade: 0,
    shortLinks: true,
    steps: ['Tap Play and let it run 2 minutes.', 'Pause for 30 seconds, then Play.', 'Tap +10s. Does it keep playing or stop?'],
    marks: [],
  },
  {
    id: 'Network',
    title: 'Losing internet',
    minutes: '4 min',
    scenario: 'class3',
    source: 'stream',
    crossfade: 0,
    shortLinks: false,
    steps: ['Tap Play.', 'Turn on airplane mode. How long does the music keep going?', 'Tap +10s. Wait for the next song.', 'Turn airplane mode off. Does it recover?'],
    marks: ['Network off', 'Network on'],
  },
];
