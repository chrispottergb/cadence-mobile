import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearExperience, getExperienceState, loadExperiences, selectExperience } from '../store';

const mockRpc = jest.fn();
jest.mock('@/auth/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
const rpc = mockRpc;

describe('experience store', () => {
  beforeEach(async () => {
    await clearExperience();
    rpc.mockReset();
  });

  it('asks the database, never the client, which experiences are allowed', async () => {
    rpc.mockResolvedValue({ data: { instructor: true, student: false, parent: false }, error: null });
    await loadExperiences();
    expect(rpc).toHaveBeenCalledWith('resolve_experiences');
    expect(getExperienceState().flags).toEqual({ instructor: true, student: false, parent: false });
    expect(getExperienceState().selected).toBe('instructor');
  });

  it('persists a switch and restores it on the next load without sign-out', async () => {
    rpc.mockResolvedValue({ data: { instructor: true, student: true, parent: false }, error: null });
    await loadExperiences();
    expect(await selectExperience('student')).toBe(true);
    expect(await AsyncStorage.getItem('cadence.experience.selected.v1')).toBe('student');

    await clearExperience();
    // clearExperience wipes the persisted key (sign-out semantics); simulate a cold start instead.
    await AsyncStorage.setItem('cadence.experience.selected.v1', 'student');
    await loadExperiences();
    expect(getExperienceState().selected).toBe('student');
  });

  it('refuses to select an experience the database did not grant', async () => {
    rpc.mockResolvedValue({ data: { instructor: false, student: true, parent: false }, error: null });
    await loadExperiences();
    expect(await selectExperience('instructor')).toBe(false);
    expect(getExperienceState().selected).toBe('student');
  });

  it('a user with nothing lands on no experience rather than crashing', async () => {
    rpc.mockResolvedValue({ data: { instructor: false, student: false, parent: false }, error: null });
    await loadExperiences();
    expect(getExperienceState().loaded).toBe(true);
    expect(getExperienceState().selected).toBeNull();
  });

  it('an RPC error yields no experiences and surfaces the error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await loadExperiences();
    expect(getExperienceState().selected).toBeNull();
    expect(getExperienceState().error).toBe('boom');
  });
});
