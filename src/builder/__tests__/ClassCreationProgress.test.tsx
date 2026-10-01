import { act, render, screen } from '@testing-library/react-native';
import { ClassCreationProgress } from '../ClassCreationProgress';
import type { ClassGeneration } from '@/music/classGeneration';
import { defaultInstructorSettings, proposeClass } from '@/soundtrack/instructor';

const startedAt = '2026-10-01T12:00:00Z';
function generation(): ClassGeneration {
  const plan = proposeClass(defaultInstructorSettings());
  plan.sections[0]!.music = [{ assetId: 'warmup', label: 'Warm-up song', durationSeconds: 300 }];
  return { plan, tracks: [{ trackId: 'warmup', title: 'Warm-up song', durationSeconds: 300, jobId: 'j1', label: 'A' }], requests: 2,
    pending: { key: 'key2', sectionId: 'main', jobId: 'j2', startedAt, state: 'RENDERING', input: { mode: 'description', style: { tags: [], exclude: [] }, instrumental: true, subject: { type: 'gym', gymId: 'gym' } } } };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(startedAt)); });
afterEach(() => jest.useRealTimers());

it('shows actual assembled coverage while elapsed time advances independently', () => {
  render(<ClassCreationProgress generation={generation()} busy pausing={false} minutes={60} source="generate" />);
  expect(screen.getByText('Generating music')).toBeTruthy();
  expect(screen.getByTestId('class-coverage')).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 8, text: '8% of class music ready' });
  expect(screen.getByText('1 track ready')).toBeTruthy();
  act(() => jest.advanceTimersByTime(90000));
  expect(screen.getByText('Current request: 1:30 elapsed')).toBeTruthy();
  expect(screen.getByTestId('class-coverage').props.accessibilityValue.now).toBe(8);
});

it('shows stored progress without a spinner when paused or failed', () => {
  const g = generation();
  const view = render(<ClassCreationProgress generation={g} busy={false} pausing={false} minutes={60} source="generate" />);
  expect(screen.getByText('Creation paused')).toBeTruthy();
  expect(screen.queryByTestId('class-creation-spinner')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  view.rerender(<ClassCreationProgress generation={{ ...g, failure: 'No playable music' }} busy={false} pausing={false} minutes={60} source="generate" />);
  expect(screen.getByText('Music generation needs attention')).toBeTruthy();
  expect(screen.getByTestId('class-coverage').props.accessibilityValue.now).toBe(8);
});

it('reflects queued, saving and pausing states and stops its timer on unmount', () => {
  const g = generation();
  g.pending!.state = 'QUEUED';
  const view = render(<ClassCreationProgress generation={g} busy pausing={false} minutes={60} source="generate" />);
  expect(screen.getByText('Waiting for music to start')).toBeTruthy();
  view.rerender(<ClassCreationProgress generation={{ ...g, pending: { ...g.pending!, state: 'RENDERING', processing: true } }} busy pausing={false} minutes={60} source="generate" />);
  expect(screen.getByText('Saving your new tracks')).toBeTruthy();
  view.rerender(<ClassCreationProgress generation={g} busy pausing minutes={60} source="generate" />);
  expect(screen.getByText('Pausing after the current request')).toBeTruthy();
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('accepts older drafts without stage or timing metadata', () => {
  const g = generation();
  delete g.pending!.startedAt; delete g.pending!.state;
  render(<ClassCreationProgress generation={g} busy pausing={false} minutes={60} source="generate" />);
  expect(screen.getByText('Checking music status')).toBeTruthy();
  expect(screen.queryByText(/elapsed/)).toBeNull();
});
