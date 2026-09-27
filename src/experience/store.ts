import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { supabase } from '@/auth/supabase';

import { availableExperiences, type Experience, type ExperienceFlags, pickExperience } from './resolve';

/**
 * Experience state: the server-resolved flags plus the locally persisted
 * selection. Switching never signs the user out.
 */
const KEY = 'cadence.experience.selected.v1';
const NONE: ExperienceFlags = { instructor: false, student: false, parent: false };

type State = {
  loaded: boolean;
  flags: ExperienceFlags;
  selected: Experience | null;
  error: string | null;
};

let state: State = { loaded: false, flags: NONE, selected: null, error: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  emit();
};

export const getExperienceState = () => state;
export const subscribeExperience = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useExperience = () => useSyncExternalStore(subscribeExperience, getExperienceState, getExperienceState);

function isExperience(v: unknown): v is Experience {
  return v === 'instructor' || v === 'student' || v === 'parent';
}

/** Ask the database which experiences this session may enter, then apply the persisted choice. */
export async function loadExperiences(): Promise<void> {
  let persisted: Experience | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    persisted = isExperience(raw) ? raw : null;
  } catch {
    persisted = null;
  }
  const { data, error } = await supabase.rpc('resolve_experiences');
  if (error) {
    set({ loaded: true, flags: NONE, selected: null, error: error.message });
    return;
  }
  const flags: ExperienceFlags = {
    instructor: data?.instructor === true,
    student: data?.student === true,
    parent: data?.parent === true,
  };
  set({ loaded: true, flags, selected: pickExperience(flags, persisted), error: null });
}

export async function selectExperience(next: Experience): Promise<boolean> {
  if (!availableExperiences(state.flags).includes(next)) return false;
  set({ selected: next });
  try {
    await AsyncStorage.setItem(KEY, next);
  } catch {
    // Selection still applies for this launch.
  }
  return true;
}

export async function clearExperience(): Promise<void> {
  state = { loaded: false, flags: NONE, selected: null, error: null };
  emit();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
