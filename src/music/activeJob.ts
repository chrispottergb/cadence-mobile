import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Remembers the generation in flight so the app can pick it back up after
 * the user leaves or the app is closed. The job itself runs on Cadence's
 * service and never depends on the app staying open. Only the job id is
 * stored: no audio, no URLs, no credentials.
 */
const KEY = 'cadence.activeGeneration';

export async function saveActiveJob(jobId: string): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ jobId, savedAt: Date.now() })).catch(() => undefined);
}

export async function loadActiveJob(maxAgeMs = 24 * 3600 * 1000): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { jobId?: string; savedAt?: number };
    if (!v.jobId || !v.savedAt || Date.now() - v.savedAt > maxAgeMs) return null;
    return v.jobId;
  } catch {
    return null;
  }
}

export async function clearActiveJob(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
