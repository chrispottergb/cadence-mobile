import * as FileSystem from 'expo-file-system/legacy';

import { exportRun } from './metrics';

/**
 * Crash-safe Audio Lab log. The in-memory log dies with the app, which is
 * exactly when it matters most (a crash or memory kill mid-test). The run is
 * written to the app's private documents folder every few seconds; after a
 * restart the lab offers the previous run for sharing. Lab measurements only:
 * no audio, no links, no user data.
 */
const DIR = `${FileSystem.documentDirectory}audiolab/`;
const CURRENT = `${DIR}current-run.json`;
const PREVIOUS = `${DIR}previous-run.json`;

/** On lab open: keep whatever the last session left behind as the "previous run". */
export async function rotateOnOpen(): Promise<boolean> {
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
    const cur = await FileSystem.getInfoAsync(CURRENT);
    if (cur.exists) {
      await FileSystem.deleteAsync(PREVIOUS, { idempotent: true });
      await FileSystem.moveAsync({ from: CURRENT, to: PREVIOUS });
    }
    return (await FileSystem.getInfoAsync(PREVIOUS)).exists;
  } catch {
    return false;
  }
}

export async function saveCurrent(device: Record<string, string | number | null>): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(CURRENT, exportRun(device));
  } catch {
    /* best effort */
  }
}

export async function readPrevious(): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(PREVIOUS);
  } catch {
    return null;
  }
}
