import { act, fireEvent, render, screen } from '@testing-library/react-native';
import InstructorHome from '../../../app/(instructor)/index';
import InstructorCreate from '../../../app/(instructor)/create';
import { listMyGyms } from '@/data/gyms';
import { listSoundtracks } from '@/data/soundtracks';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockFocus: () => (() => void) | void;
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { useRouter: () => mockRouter, useFocusEffect: (callback: () => (() => void) | void) => {
    mockFocus = callback;
    React.useEffect(callback, [callback]);
  } };
});
jest.mock('@/data/gyms', () => ({ listMyGyms: jest.fn() }));
jest.mock('@/data/soundtracks', () => ({ listSoundtracks: jest.fn() }));
jest.mock('@/auth/session', () => ({ useSession: () => ({ session: { user: { id: 'user-1' } } }) }));
const gyms = jest.mocked(listMyGyms);
const classes = jest.mocked(listSoundtracks);
const row = { id: 'class-1', gymId: 'gym-1', name: 'Tuesday Fundamentals', durationSeconds: 3600, revision: 1, updatedAt: '2026-09-30T12:00:00Z' };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  gyms.mockResolvedValue({ gyms: [{ id: 'gym-1', name: 'Gym', slug: 'gym', owner_profile_id: 'user' }], error: null });
  classes.mockResolvedValue({ rows: [row], error: null });
});

it('offers the saved draft on Home without hiding saved classes', async () => {
  await AsyncStorage.setItem('instructor-class:v1:user-1:gym-1', '{}');
  render(<InstructorHome />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Continue creating your class'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/soundtracks/new');
  expect(screen.getByText('Tuesday Fundamentals')).toBeTruthy();
  expect(screen.getByTestId('home-tutorial')).toBeTruthy();
});

it('the actual instructor home route opens creation, saved class edit/start and the library', async () => {
  render(<InstructorHome />);
  await act(async () => {});
  expect(screen.getByText('Ready to teach?')).toBeTruthy();
  expect(screen.queryByText(/later phase/)).toBeNull();
  fireEvent.press(screen.getByText('Create class soundtrack'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/soundtracks/new');
  fireEvent.press(screen.getByTestId('st-edit-class-1'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/soundtracks/[id]', params: { id: 'class-1' } });
  fireEvent.press(screen.getByTestId('st-run-class-1'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/soundtracks/[id]/run', params: { id: 'class-1' } });
  fireEvent.press(screen.getByText('Open music library'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/(instructor)/library');
});

it('shows a useful empty state and picks up a saved class on return to Home', async () => {
  classes.mockResolvedValueOnce({ rows: [], error: null });
  render(<InstructorHome />);
  await act(async () => {});
  expect(screen.getByText('Your first class starts here')).toBeTruthy();
  expect(screen.getByTestId('st-new')).toBeEnabled();
  await act(async () => { mockFocus(); });
  expect(screen.getByText('Tuesday Fundamentals')).toBeTruthy();
  expect(screen.queryByText('Your first class starts here')).toBeNull();
});

it('shows retry after a request failure and recovers', async () => {
  classes.mockRejectedValueOnce(new Error('offline'));
  render(<InstructorHome />);
  await act(async () => {});
  expect(screen.getByText(/Could not load your classes/)).toBeTruthy();
  expect(screen.queryByText('Your first class starts here')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByText('Try again')); });
  expect(screen.getByText('Tuesday Fundamentals')).toBeTruthy();
  expect(screen.queryByText(/Could not load your classes/)).toBeNull();
});

it('explains the missing gym instead of leaving an empty home', async () => {
  gyms.mockResolvedValueOnce({ gyms: [], error: null });
  render(<InstructorHome />);
  await act(async () => {});
  expect(screen.getByText('Create or join a gym as staff to build classes.')).toBeTruthy();
  expect(screen.getByTestId('st-new')).toBeDisabled();
  expect(classes).not.toHaveBeenCalled();
});

it('the actual Create tab leads with class creation instead of the development generator', () => {
  render(<InstructorCreate />);
  expect(screen.queryByText(/later phase|development/)).toBeNull();
  fireEvent.press(screen.getByTestId('create-class'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/soundtracks/new');
  fireEvent.press(screen.getByText('Open saved classes'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/soundtracks');
});
