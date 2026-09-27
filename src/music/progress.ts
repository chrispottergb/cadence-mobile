import type { GenerationJob } from './client';

/**
 * Estimated progress for a generation. The provider reports stages, not a
 * percentage, so this blends the current stage with elapsed time against a
 * typical total. It never reaches 100% until the job is actually finished,
 * and it says so plainly when a job runs longer than usual.
 */
export const TYPICAL_SECONDS = 150;

export interface Progress {
  fraction: number; // 0..1
  elapsedSeconds: number;
  remainingSeconds: number | null; // null once we are past the typical time
  label: string;
  slow: boolean;
  done: boolean;
}

const STAGE_FLOOR: Record<string, number> = { QUEUED: 0.03, SUBMITTED: 0.1, RENDERING: 0.2 };

export function estimateProgress(job: Pick<GenerationJob, 'state' | 'candidates'> & { createdAt?: string | null }, now: number, typical = TYPICAL_SECONDS): Progress {
  const started = job.createdAt ? Date.parse(job.createdAt) : now;
  const elapsed = Math.max(0, (now - started) / 1000);
  if (job.state === 'READY' || job.state === 'PARTIAL' || job.state === 'FAILED') {
    return { fraction: 1, elapsedSeconds: elapsed, remainingSeconds: 0, label: job.state === 'FAILED' ? 'Failed' : 'Done', slow: false, done: true };
  }
  const processing = job.candidates.some((c) => c.status === 'processing' || c.status === 'ready');
  const floor = processing ? 0.9 : (STAGE_FLOOR[job.state] ?? 0.03);
  // Time-based estimate eases toward 90% and never passes it before takes arrive.
  const byTime = 0.9 * (1 - Math.exp((-2.3 * elapsed) / typical));
  const cap = processing ? 0.98 : 0.9;
  const fraction = Math.min(cap, Math.max(floor, byTime));
  const slow = elapsed > typical * 1.25;
  const remaining = slow ? null : Math.max(5, Math.round(typical - elapsed));
  const label = processing ? 'Saving your takes' : job.state === 'QUEUED' ? 'Waiting to start' : job.state === 'SUBMITTED' ? 'Sent to the composer' : 'Composing';
  return { fraction, elapsedSeconds: elapsed, remainingSeconds: remaining, label, slow, done: false };
}

export function formatRemaining(p: Progress): string {
  if (p.done) return '';
  if (p.slow) return 'Taking longer than usual. You can leave the app; it keeps going.';
  const s = p.remainingSeconds ?? 0;
  return s >= 60 ? `About ${Math.ceil(s / 60)} min left` : `About ${s} s left`;
}
