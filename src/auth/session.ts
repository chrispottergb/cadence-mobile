import type { Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

import { supabase } from './supabase';

/**
 * Session store. Supabase persists the session in AsyncStorage and refreshes
 * it; this mirrors the current value into a synchronous store the router can
 * read. `ready` flips once the persisted session has been loaded.
 */
type State = { ready: boolean; session: Session | null };

let state: State = { ready: false, session: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(next: Partial<State>) {
  state = { ...state, ...next };
  emit();
}

let started = false;
export function startSession(): void {
  if (started) return;
  started = true;
  void supabase.auth.getSession().then(({ data }) => set({ ready: true, session: data.session }));
  supabase.auth.onAuthStateChange((_event, session) => set({ ready: true, session }));
}

export const getSession = () => state;
export const subscribeSession = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useSession(): State {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

export async function sendEmailCode(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  return error ? error.message : null;
}

export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.replace(/\D/g, ''),
    type: 'email',
  });
  return error ? error.message : null;
}

/** Test builds only: anonymous session (requires anonymous sign-ins enabled in Supabase). */
export async function signInAsGuest(): Promise<string | null> {
  const { error } = await supabase.auth.signInAnonymously();
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Test seam. */
export function __resetSessionForTests() {
  state = { ready: false, session: null };
  started = false;
}
