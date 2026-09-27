import { estimateProgress, formatRemaining } from '../progress';

const t0 = Date.parse('2026-09-27T12:00:00Z');
const job = (state: string, secondsAgo: number, candidates: { status: string }[] = []) =>
  ({ state, createdAt: new Date(t0 - secondsAgo * 1000).toISOString(), candidates }) as never;

describe('estimateProgress', () => {
  it('starts low and grows with time, never finishing early', () => {
    const a = estimateProgress(job('QUEUED', 1), t0);
    const b = estimateProgress(job('RENDERING', 60), t0);
    const c = estimateProgress(job('RENDERING', 10_000), t0);
    expect(a.fraction).toBeLessThan(0.1);
    expect(b.fraction).toBeGreaterThan(a.fraction);
    expect(c.fraction).toBeLessThanOrEqual(0.9);
    expect(c.done).toBe(false);
  });

  it('respects stage floors', () => {
    expect(estimateProgress(job('RENDERING', 0), t0).fraction).toBeGreaterThanOrEqual(0.2);
    expect(estimateProgress(job('RENDERING', 0, [{ status: 'processing' }]), t0).fraction).toBeGreaterThanOrEqual(0.9);
  });

  it('is complete only for terminal states', () => {
    expect(estimateProgress(job('READY', 5), t0)).toMatchObject({ fraction: 1, done: true, label: 'Done' });
    expect(estimateProgress(job('FAILED', 5), t0)).toMatchObject({ done: true, label: 'Failed' });
  });

  it('reports remaining time, then says when it is slow', () => {
    expect(formatRemaining(estimateProgress(job('RENDERING', 30), t0))).toBe('About 2 min left');
    expect(formatRemaining(estimateProgress(job('RENDERING', 140), t0))).toBe('About 10 s left');
    const slow = estimateProgress(job('RENDERING', 400), t0);
    expect(slow.slow).toBe(true);
    expect(formatRemaining(slow)).toMatch(/longer than usual/);
  });
});
