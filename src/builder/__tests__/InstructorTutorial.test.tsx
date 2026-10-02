import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from '@/ui';
import { InstructorTutorial, InstructorTutorialProvider, useInstructorTutorial } from '../InstructorTutorial';

const mockRouter = { push: jest.fn() };
let mockUser = 'instructor-1';
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/auth/session', () => ({ useSession: () => ({ session: { user: { id: mockUser } } }) }));

function Home() {
  const { openTutorial } = useInstructorTutorial();
  return <Button title="Tutorial" onPress={openTutorial} />;
}
const app = () => <InstructorTutorialProvider><Home /></InstructorTutorialProvider>;
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); mockUser = 'instructor-1'; });

it('opens once, persists Skip, and allows replay from Home', async () => {
  const first = render(app());
  await act(async () => {});
  expect(screen.getByTestId('tutorial-next')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Skip intro')); });
  expect(await AsyncStorage.getItem('instructor-tutorial:v1:instructor-1')).toBe('seen');
  expect(screen.queryByTestId('tutorial-next')).toBeNull();
  first.unmount();
  render(app());
  await act(async () => {});
  expect(screen.queryByTestId('tutorial-next')).toBeNull();
  fireEvent.press(screen.getByText('Tutorial'));
  expect(screen.getByText('1 of 4 · Your class')).toBeTruthy();
});

it('completes into creation and keeps first-use state separate for another instructor', async () => {
  const view = render(app());
  await act(async () => {});
  for (let i = 0; i < 3; i++) fireEvent.press(screen.getByTestId('tutorial-next'));
  await act(async () => { fireEvent.press(screen.getByText('Create my class')); });
  expect(mockRouter.push).toHaveBeenCalledWith('/soundtracks/new');
  expect(await AsyncStorage.getItem('instructor-tutorial:v1:instructor-1')).toBe('seen');
  mockUser = 'instructor-2';
  view.rerender(app());
  await act(async () => {});
  expect(screen.getByText('1 of 4 · Your class')).toBeTruthy();
});

it('supports swipe paging, Back and accessible direct card controls', () => {
  render(<InstructorTutorial onSkip={jest.fn()} onCreate={jest.fn()} />);
  // The test runtime supplies its own window width; use the first rendered page width.
  const pages = screen.getByTestId('tutorial-pages');
  const width = jest.requireActual('react-native').Dimensions.get('window').width;
  fireEvent(pages, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: width * 2 } } });
  expect(screen.getByText('3 of 4 · Your music')).toBeTruthy();
  fireEvent.press(screen.getByText('Back'));
  expect(screen.getByText('2 of 4 · Timing & cues')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Tutorial card 4: Ready to teach'));
  expect(screen.getByText('Create my class')).toBeTruthy();
});

it('still lets instructors leave when local storage is unavailable', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  render(app());
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('Skip intro')); });
  expect(screen.queryByTestId('tutorial-next')).toBeNull();
});
